// @ts-check
'use strict';

/**
 * Agent tool definitions and execution, shared by both agent loops
 * (agent-execute and agent-execute-editor in src/main/ipc/handlers/agent.js).
 *
 * This module must stay free of require('electron') so its pure helpers
 * (classifier, truncation, fallback parser, edit matching, history trimming)
 * can be loaded directly by `node --test`.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ---- Limits (single source of truth) ----
const BASH_TIMEOUT_MS = 60000;
const BASH_OUTPUT_CAP = 1024 * 1024; // raw stdout+stderr capture
const MODEL_RESULT_MAX_CHARS = 8000; // tool result → model messages
const MODEL_RESULT_HEAD = 5000;
const MODEL_RESULT_TAIL = 3000;
const READ_FILE_MAX_LINES = 2000;
const READ_FILE_MAX_BYTES = 100 * 1024;
const SEARCH_MAX_MATCHES = 50;
const SEARCH_MAX_FILES = 2000;
const SEARCH_EXCERPT_CHARS = 200;
const SEARCH_FILE_SIZE_CAP = 1024 * 1024;
const FETCH_MAX_CHARS = 20 * 1024;
const FETCH_TIMEOUT_MS = 20000;
const FETCH_MAX_REDIRECTS = 3;
const HISTORY_HARD_CAP = 200;

async function readPdfText(filePath) {
  const { extractPdfText } = require('./pdfText');
  return extractPdfText(filePath);
}

// Tool definitions (Ollama/OpenAI function-calling shape)
const agentTools = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute a shell command and return the output. Use this for running any shell command like kubectl, git, npm, ls, cat, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a text file or extract text from a PDF document. Use this directly for .pdf files; no external PDF command-line tools are needed. Large files are returned in chunks — pass offset to continue reading.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to read'
          },
          offset: {
            type: 'number',
            description: 'Optional 1-based line number to start reading from (default 1)'
          },
          limit: {
            type: 'number',
            description: 'Optional maximum number of lines to read (default 2000)'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_pdf',
      description: 'Extract readable text from a PDF document so it can be summarized or analyzed. Use this for .pdf files instead of shell commands like pdftotext.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the PDF file to read'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does. For small changes to an existing file prefer edit_file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to write'
          },
          content: {
            type: 'string',
            description: 'The content to write to the file'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Make a targeted change to an existing file by replacing an exact text snippet. Safer than write_file for modifying files: the rest of the file is left untouched. old_string must match the file exactly (including whitespace) and must be unique unless replace_all is true.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to edit'
          },
          old_string: {
            type: 'string',
            description: 'The exact text to replace (must be unique in the file unless replace_all is true)'
          },
          new_string: {
            type: 'string',
            description: 'The text to replace it with'
          },
          replace_all: {
            type: 'boolean',
            description: 'Replace every occurrence of old_string (default false)'
          }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories in a path',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The directory path to list'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search file contents recursively for a regular expression. Returns matching lines as relative-path:line: excerpt. Use this to find where something is defined or mentioned in a project.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The regular expression to search for (case-insensitive)'
          },
          path: {
            type: 'string',
            description: 'Optional directory to search in (default: current working directory)'
          },
          file_glob: {
            type: 'string',
            description: 'Optional filename filter like *.js or *.md'
          }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch a web page by URL and return its readable text content. Use this to read a specific page (documentation, article, changelog) when you already know the URL; use tavily_search to discover URLs.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The http(s) URL to fetch'
          }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'tavily_search',
      description: 'Search the internet using Tavily API. Returns current information from web search results. Use this when you need up-to-date information, facts, news, or documentation from the internet.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query'
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results to return (default: 5)',
            default: 5
          }
        },
        required: ['query']
      }
    }
  }
];

const TOOL_NAMES = agentTools.map((t) => t.function.name);

// Tools that never mutate anything and can run without a permission prompt.
const READONLY_TOOLS = new Set(['read_file', 'read_pdf', 'list_files', 'tavily_search', 'search_files', 'fetch_url']);

// ---- Token estimation & history trimming ----

// Rough token estimate: ~4 chars per token for English text
function estimateTokens(messages) {
  let chars = 0;
  for (const msg of messages) {
    chars += (msg.content || '').length;
    if (msg.tool_calls) chars += JSON.stringify(msg.tool_calls).length;
  }
  return Math.ceil(chars / 4);
}

/**
 * Drop the oldest history entries until the estimated token count fits the
 * budget. Always keeps at least the most recent entry, and applies a hard
 * entry cap as a backstop. Returns a new array.
 * @param {Array<object>} history
 * @param {number} budgetTokens
 * @param {number} [hardCap]
 */
function trimHistoryToTokenBudget(history, budgetTokens, hardCap = HISTORY_HARD_CAP) {
  let trimmed = history.length > hardCap ? history.slice(-hardCap) : history.slice();
  while (trimmed.length > 1 && estimateTokens(trimmed) > budgetTokens) {
    trimmed.shift();
  }
  return trimmed;
}

// ---- Tool argument normalization ----

function normalizeToolArguments(args) {
  if (!args) return {};
  if (typeof args === 'string') {
    try {
      return normalizeToolArguments(JSON.parse(args));
    } catch {
      return { command: args };
    }
  }
  if (Array.isArray(args)) return { command: args.map(stringifyValue).join(' ') };
  if (typeof args !== 'object') return { command: String(args) };

  const normalized = { ...args };
  for (const key of Object.keys(normalized)) {
    if (normalized[key] != null && typeof normalized[key] === 'object') {
      normalized[key] = stringifyValue(normalized[key]);
    }
  }
  return normalized;
}

function stringifyValue(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(stringifyValue).join(' ');
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    if (typeof value.value === 'string') return value.value;
    return JSON.stringify(value);
  }
  return String(value);
}

// ---- Read-only classification (permission gate) ----

const READONLY_COMMANDS = new Set([
  // POSIX / common CLI
  'ls', 'pwd', 'cat', 'head', 'tail', 'more', 'less', 'grep', 'egrep', 'fgrep',
  'rg', 'ag', 'find', 'fd', 'which', 'whereis', 'whoami', 'id', 'wc', 'sort',
  'uniq', 'cut', 'diff', 'cmp', 'file', 'stat', 'du', 'df', 'date', 'cal',
  'uname', 'hostname', 'basename', 'dirname', 'realpath', 'readlink', 'tree',
  'ps', 'env', 'printenv', 'echo', 'printf', 'jq', 'md5', 'md5sum', 'shasum',
  'sha256sum', 'strings', 'nl', 'column',
  // Windows (cmd.exe builtins / standard tools)
  'dir', 'type', 'where', 'findstr', 'ver', 'tasklist', 'systeminfo', 'fc'
]);

const GIT_READONLY_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'show', 'blame', 'shortlog', 'describe', 'rev-parse',
  'ls-files', 'ls-tree', 'ls-remote', 'grep', 'reflog', 'cat-file', 'show-ref'
]);

// Subcommands that only stay read-only in their bare/list form
// (e.g. `git branch -a` lists, `git branch foo` creates).
const GIT_LIST_ONLY_SUBCOMMANDS = new Set(['branch', 'remote', 'stash', 'tag', 'worktree']);

/**
 * Classify a bash command as read-only or requiring permission.
 * Conservative: any shell metacharacter that could redirect, chain, or
 * substitute makes it needs-permission; pipes are allowed only when every
 * segment is independently read-only.
 * @param {string} command
 * @returns {'readonly' | 'needs-permission'}
 */
function classifyBashCommand(command) {
  const cmd = String(command || '').trim();
  if (!cmd) return 'needs-permission';
  if (/[><;&`\n]/.test(cmd) || cmd.includes('$(')) return 'needs-permission';
  for (const segment of cmd.split('|')) {
    if (!segmentIsReadOnly(segment.trim())) return 'needs-permission';
  }
  return 'readonly';
}

function segmentIsReadOnly(segment) {
  if (!segment) return false;
  const tokens = segment.split(/\s+/);
  let first = tokens[0].toLowerCase();
  // Strip any path prefix and a Windows .exe suffix so `/usr/bin/grep` and
  // `findstr.exe` classify like their bare names.
  first = first.replace(/\\/g, '/').split('/').pop() || '';
  first = first.replace(/\.exe$/, '');

  if (first === 'git') {
    const sub = (tokens[1] || '').toLowerCase();
    if (GIT_READONLY_SUBCOMMANDS.has(sub)) return true;
    if (GIT_LIST_ONLY_SUBCOMMANDS.has(sub)) {
      // List form only: flags and the literal `list` keyword, no positional
      // args (which would create/delete/apply).
      return tokens.slice(2).every((t) => t.startsWith('-') || t.toLowerCase() === 'list');
    }
    if (sub === 'config') {
      const flag = (tokens[2] || '').toLowerCase();
      return flag === '--get' || flag === '--get-all' || flag === '--list' || flag === '-l';
    }
    return false;
  }

  return READONLY_COMMANDS.has(first);
}

/**
 * Whether a tool call is read-only (auto-allowed in 'auto' permission mode).
 * Unknown tools default to needing permission so future tools are born safe.
 * @param {string} toolName
 * @param {object} args normalized tool arguments
 */
function isReadOnlyToolCall(toolName, args) {
  if (READONLY_TOOLS.has(toolName)) return true;
  if (toolName === 'bash') return classifyBashCommand(args && args.command) === 'readonly';
  return false;
}

// ---- Model-facing truncation ----

/**
 * Cap a tool result before it enters the model's message list. Keeps the head
 * and tail (errors and summaries tend to live at the edges) with an explicit
 * marker so the model knows content is missing.
 * @param {string} text
 * @param {number} [max]
 */
function truncateForModel(text, max = MODEL_RESULT_MAX_CHARS) {
  const value = String(text == null ? '' : text);
  if (value.length <= max) return value;
  const omitted = value.length - MODEL_RESULT_HEAD - MODEL_RESULT_TAIL;
  return (
    value.slice(0, MODEL_RESULT_HEAD) +
    `\n\n...[truncated ${omitted} chars — output too large; refine the command or read in smaller chunks]...\n\n` +
    value.slice(-MODEL_RESULT_TAIL)
  );
}

// ---- Fallback tool-call parsing (models without native tool calling) ----

/**
 * Extract tool calls from plain assistant text. Accepts a JSON object or an
 * array of objects with `name` + `parameters`/`arguments`, optionally inside
 * ```json fences. Matches by tool NAME only against the known tool list.
 * @param {string} content
 * @param {string[]} knownToolNames
 * @returns {Array<{function: {name: string, arguments: object}}>}
 */
function parseFallbackToolCalls(content, knownToolNames = TOOL_NAMES) {
  if (!content) return [];
  const known = new Set(knownToolNames);

  const fenced = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/g;
  let m;
  while ((m = fenceRe.exec(content)) !== null) fenced.push(m[1]);
  const source = fenced.length ? fenced.join('\n') : content;

  const calls = [];
  for (const value of extractJsonValues(source)) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      if (typeof item.name !== 'string' || !known.has(item.name)) continue;
      const args = item.parameters || item.arguments || {};
      calls.push({ function: { name: item.name, arguments: normalizeToolArguments(args) } });
    }
  }
  return calls;
}

// Scan text for balanced top-level {...} / [...] spans that parse as JSON.
function extractJsonValues(text) {
  const values = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      const end = findBalancedEnd(text, i);
      if (end !== -1) {
        try {
          values.push(JSON.parse(text.slice(i, end + 1)));
          i = end + 1;
          continue;
        } catch (_) {
          // Not valid JSON — keep scanning from the next char.
        }
      }
    }
    i++;
  }
  return values;
}

function findBalancedEnd(text, start) {
  const close = text[start] === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return ch === close ? i : -1;
    }
  }
  return -1;
}

// ---- edit_file matching ----

/**
 * Apply an exact-string replacement.
 * @param {string} content
 * @param {string} oldString
 * @param {string} newString
 * @param {boolean} [replaceAll]
 * @returns {{ok: true, content: string, count: number} | {ok: false, error: string}}
 */
function applyEdit(content, oldString, newString, replaceAll = false) {
  if (!oldString) return { ok: false, error: 'old_string must not be empty' };
  let count = 0;
  let idx = content.indexOf(oldString);
  while (idx !== -1) {
    count++;
    idx = content.indexOf(oldString, idx + oldString.length);
  }
  if (count === 0) return { ok: false, error: 'old_string not found in file' };
  if (count > 1 && !replaceAll) {
    return { ok: false, error: `old_string matched ${count} times; provide a larger unique snippet or set replace_all: true` };
  }
  const next = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, () => newString);
  return { ok: true, content: next, count: replaceAll ? count : 1 };
}

// ---- read_file paging ----

/**
 * Slice file content by 1-based line offset/limit, capped by line count and
 * byte size, with an explicit continuation notice when truncated.
 * @param {string} content
 * @param {number|string} [offset]
 * @param {number|string} [limit]
 */
function pageFileContent(content, offset, limit) {
  const lines = String(content).split('\n');
  const total = lines.length;
  const start = Math.max(1, parseInt(String(offset), 10) || 1);
  if (start > total) {
    return `Error: offset ${start} is past the end of the file (${total} lines)`;
  }
  const requested = parseInt(String(limit), 10) || READ_FILE_MAX_LINES;
  const maxLines = Math.max(1, Math.min(requested, READ_FILE_MAX_LINES));

  let slice = lines.slice(start - 1, start - 1 + maxLines);
  let text = slice.join('\n');
  while (slice.length > 1 && text.length > READ_FILE_MAX_BYTES) {
    slice.pop();
    text = slice.join('\n');
  }
  const end = start + slice.length - 1;

  if (start === 1 && end === total) return text;
  return `${text}\n[Truncated: showed lines ${start}-${end} of ${total}. Call read_file again with offset=${end + 1} to continue.]`;
}

// ---- bash execution (async, killable) ----

/**
 * Kill an agent child process and its descendants, cross-platform.
 * @param {import('child_process').ChildProcess|null} child
 */
function killChildProcess(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      } catch (_) {
        child.kill();
      }
    } else {
      try {
        // Negative pid = the process group (requires detached spawn).
        process.kill(-child.pid, 'SIGKILL');
      } catch (_) {
        child.kill('SIGKILL');
      }
    }
  } catch (_) {
    // Process already gone.
  }
}

/**
 * Run a shell command without blocking the main process. Always resolves to
 * a string (never rejects) so the agent loop's tool-result contract holds.
 * The child is registered on state.agentChildProcess so claude-stop can kill it.
 * @param {string} command
 * @param {string} cwd
 * @param {object} [state] sessionState-like object
 */
function runBashCommand(command, cwd, state) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(String(command || ''), {
        shell: true,
        cwd,
        windowsHide: true,
        detached: process.platform !== 'win32'
      });
    } catch (e) {
      resolve(`Error: ${e.message}`);
      return;
    }

    if (state) state.agentChildProcess = child;

    let output = '';
    let capped = false;
    let killedByTimeout = false;
    let settled = false;

    const append = (chunk) => {
      if (capped) return;
      output += chunk.toString();
      if (output.length > BASH_OUTPUT_CAP) {
        output = output.slice(0, BASH_OUTPUT_CAP);
        capped = true;
      }
    };
    if (child.stdout) child.stdout.on('data', append);
    if (child.stderr) child.stderr.on('data', append);

    const timer = setTimeout(() => {
      killedByTimeout = true;
      killChildProcess(child);
    }, BASH_TIMEOUT_MS);

    const finish = (text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (state && state.agentChildProcess === child) state.agentChildProcess = null;
      resolve(text);
    };

    child.on('error', (err) => finish(`Error: ${err.message}`));
    child.on('close', (code, signal) => {
      let text = output;
      if (capped) text += '\n[output capped at 1MB]';
      if (state && state.agentAborted) {
        finish('Command aborted by user');
      } else if (killedByTimeout) {
        finish(`Error: command timed out after ${BASH_TIMEOUT_MS / 1000}s\n${text}`);
      } else if (signal) {
        finish(`Error: command killed by signal ${signal}\n${text}`);
      } else if (code !== 0) {
        finish(`Error (exit ${code}):\n${text}`);
      } else {
        finish(text || '(command completed with no output)');
      }
    });
  });
}

// ---- search_files ----

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage']);
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.icns', '.pdf', '.zip', '.gz', '.tar',
  '.db', '.sqlite', '.exe', '.dll', '.dylib', '.so', '.node', '.woff', '.woff2',
  '.ttf', '.eot', '.otf', '.mp3', '.mp4', '.mov', '.avi', '.bin', '.asar', '.dmg'
]);

function globToRegExp(glob) {
  const escaped = String(glob)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function searchFiles(pattern, rootPath, fileGlob) {
  if (!pattern) return 'Error: pattern is required';
  let re;
  try {
    re = new RegExp(pattern, 'i');
  } catch (e) {
    return `Error: invalid pattern: ${e.message}`;
  }
  if (!fs.existsSync(rootPath)) return `Error: Directory not found: ${rootPath}`;

  const globRe = fileGlob ? globToRegExp(fileGlob) : null;
  const matches = [];
  let filesVisited = 0;
  let cappedNote = '';
  const stack = [rootPath];

  outer:
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (globRe && !globRe.test(entry.name)) continue;
      if (BINARY_EXTS.has(path.extname(entry.name).toLowerCase())) continue;
      filesVisited++;
      if (filesVisited > SEARCH_MAX_FILES) {
        cappedNote = `\n[capped: stopped after scanning ${SEARCH_MAX_FILES} files]`;
        break outer;
      }
      let text;
      try {
        if (fs.statSync(full).size > SEARCH_FILE_SIZE_CAP) continue;
        text = fs.readFileSync(full, 'utf-8');
      } catch (_) {
        continue;
      }
      const lines = text.split('\n');
      for (let ln = 0; ln < lines.length; ln++) {
        if (re.test(lines[ln])) {
          matches.push(`${path.relative(rootPath, full)}:${ln + 1}: ${lines[ln].trim().slice(0, SEARCH_EXCERPT_CHARS)}`);
          if (matches.length >= SEARCH_MAX_MATCHES) {
            cappedNote = `\n[capped at ${SEARCH_MAX_MATCHES} matches — narrow the pattern for more]`;
            break outer;
          }
        }
      }
    }
  }

  if (matches.length === 0) return `No matches found for: ${pattern}`;
  return matches.join('\n') + cappedNote;
}

// ---- fetch_url ----

function htmlToText(html) {
  let text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > FETCH_MAX_CHARS) {
    text = text.slice(0, FETCH_MAX_CHARS) + '\n[truncated]';
  }
  return text || '(no text content)';
}

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(String(url || ''));
    } catch (_) {
      resolve(`Error: invalid URL: ${url}`);
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      resolve('Error: only http and https URLs are supported');
      return;
    }

    const mod = parsed.protocol === 'https:' ? require('https') : require('http');
    let raw = '';
    let settled = false;
    const finish = (text) => {
      if (settled) return;
      settled = true;
      resolve(text);
    };

    const req = mod.request(
      parsed,
      { method: 'GET', headers: { Accept: 'text/html,*/*', 'User-Agent': 'vomit-agent' } },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 301 && status <= 308 && res.headers.location) {
          res.resume();
          if (redirects >= FETCH_MAX_REDIRECTS) {
            finish('Error: too many redirects');
            return;
          }
          let nextUrl;
          try {
            nextUrl = new URL(res.headers.location, parsed).toString();
          } catch (_) {
            finish(`Error: invalid redirect location from ${parsed.hostname}`);
            return;
          }
          fetchUrl(nextUrl, redirects + 1).then(finish);
          return;
        }
        if (status !== 200) {
          res.resume();
          finish(`Error: HTTP ${status} from ${parsed.hostname}`);
          return;
        }
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
          // Stop pulling once we have far more raw HTML than we can use.
          if (raw.length > FETCH_MAX_CHARS * 20) req.destroy();
        });
        res.on('end', () => finish(htmlToText(raw)));
      }
    );

    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy();
      finish(raw ? htmlToText(raw) : `Error: request timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    });
    req.on('error', (err) => {
      finish(raw ? htmlToText(raw) : `Error: ${err.message}`);
    });
    req.end();
  });
}

// ---- tavily_search ----

function tavilySearch(safeArgs, configStore) {
  const apiKey = (configStore && configStore.getTavilyApiKey()) || process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return Promise.resolve('Error: Tavily API key not set. Add it via the AI menu → Set Tavily API Key...');
  }

  const https = require('https');
  const maxResults = safeArgs.max_results || 5;
  const requestBody = JSON.stringify({
    api_key: apiKey,
    query: safeArgs.query,
    search_depth: 'basic',
    max_results: maxResults,
    include_answer: true
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.tavily.com',
        port: 443,
        path: '/search',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.error) {
              resolve(`Error from Tavily: ${result.error}`);
              return;
            }
            let output = '';
            if (result.answer) {
              output += `Answer: ${result.answer}\n\n`;
            }
            if (result.results && result.results.length > 0) {
              output += 'Sources:\n';
              result.results.forEach((item, idx) => {
                output += `\n${idx + 1}. ${item.title}\n`;
                output += `   URL: ${item.url}\n`;
                output += `   ${item.content}\n`;
              });
            } else {
              output += 'No results found.';
            }
            resolve(output);
          } catch (e) {
            resolve(`Error parsing Tavily response: ${e.message}`);
          }
        });
      }
    );

    req.on('error', (err) => {
      resolve(`Error calling Tavily API: ${err.message}`);
    });
    req.write(requestBody);
    req.end();
  });
}

// ---- Tool executor ----

function resolveAgainstCwd(p, cwd) {
  const value = String(p || '');
  return path.isAbsolute(value) ? value : path.join(cwd, value);
}

/**
 * Execute a tool and return the result as a string. Never rejects.
 * Permission checks happen in the agent loop BEFORE this is called.
 * @param {string} toolName
 * @param {object} args
 * @param {string} cwd
 * @param {{configStore?: object, state?: object}} [deps]
 */
async function executeAgentTool(toolName, args, cwd, deps = {}) {
  const { configStore, state } = deps;
  const safeArgs = normalizeToolArguments(args);
  try {
    switch (toolName) {
      case 'bash': {
        return await runBashCommand(safeArgs.command, cwd, state);
      }
      case 'read_file': {
        const filePath = resolveAgainstCwd(safeArgs.path, cwd);
        if (!fs.existsSync(filePath)) {
          return `Error: File not found: ${filePath}`;
        }
        if (path.extname(filePath).toLowerCase() === '.pdf') {
          return await readPdfText(filePath);
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return pageFileContent(content, safeArgs.offset, safeArgs.limit);
      }
      case 'read_pdf': {
        const filePath = resolveAgainstCwd(safeArgs.path, cwd);
        if (!fs.existsSync(filePath)) {
          return `Error: File not found: ${filePath}`;
        }
        if (path.extname(filePath).toLowerCase() !== '.pdf') {
          return `Error: Not a PDF file: ${filePath}`;
        }
        return await readPdfText(filePath);
      }
      case 'write_file': {
        const filePath = resolveAgainstCwd(safeArgs.path, cwd);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, String(safeArgs.content || ''), 'utf-8');
        return `File written: ${filePath}`;
      }
      case 'edit_file': {
        const filePath = resolveAgainstCwd(safeArgs.path, cwd);
        if (!fs.existsSync(filePath)) {
          return `Error: File not found: ${filePath}`;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        const result = applyEdit(
          content,
          String(safeArgs.old_string != null ? safeArgs.old_string : ''),
          String(safeArgs.new_string != null ? safeArgs.new_string : ''),
          safeArgs.replace_all === true || safeArgs.replace_all === 'true'
        );
        if (!result.ok) return `Error: ${result.error}`;
        fs.writeFileSync(filePath, result.content, 'utf-8');
        return `File edited: ${filePath} (${result.count} replacement${result.count === 1 ? '' : 's'})`;
      }
      case 'list_files': {
        const dirPath = resolveAgainstCwd(safeArgs.path, cwd);
        if (!fs.existsSync(dirPath)) {
          return `Error: Directory not found: ${dirPath}`;
        }
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        return items.map((item) => `${item.isDirectory() ? '[dir] ' : ''}${item.name}`).join('\n');
      }
      case 'search_files': {
        const rootPath = resolveAgainstCwd(safeArgs.path || '.', cwd);
        return searchFiles(safeArgs.pattern, rootPath, safeArgs.file_glob);
      }
      case 'fetch_url': {
        return await fetchUrl(safeArgs.url);
      }
      case 'tavily_search': {
        return await tavilySearch(safeArgs, configStore);
      }
      default:
        return `Error: Unknown tool: ${toolName}`;
    }
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

module.exports = {
  agentTools,
  TOOL_NAMES,
  executeAgentTool,
  runBashCommand,
  killChildProcess,
  normalizeToolArguments,
  classifyBashCommand,
  isReadOnlyToolCall,
  truncateForModel,
  parseFallbackToolCalls,
  applyEdit,
  pageFileContent,
  estimateTokens,
  trimHistoryToTokenBudget,
  LIMITS: {
    BASH_TIMEOUT_MS,
    BASH_OUTPUT_CAP,
    MODEL_RESULT_MAX_CHARS,
    READ_FILE_MAX_LINES,
    READ_FILE_MAX_BYTES,
    SEARCH_MAX_MATCHES,
    FETCH_MAX_CHARS,
    HISTORY_HARD_CAP
  }
};

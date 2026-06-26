// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const aiProviders = require('../../services/aiProviders');

async function readPdfText(filePath) {
  const { extractPdfText } = require('../../services/pdfText');
  return extractPdfText(filePath);
}

// Tool definitions for Ollama
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
      description: 'Read the contents of a text file or extract text from a PDF document. Use this directly for .pdf files; no external PDF command-line tools are needed.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to read'
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
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
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

// Rough token estimate: ~4 chars per token for English text
function estimateTokens(messages) {
  let chars = 0;
  for (const msg of messages) {
    chars += (msg.content || '').length;
    if (msg.tool_calls) chars += JSON.stringify(msg.tool_calls).length;
  }
  return Math.ceil(chars / 4);
}

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

// Execute a tool and return the result
async function executeAgentTool(toolName, args, cwd, configStore) {
  const safeArgs = normalizeToolArguments(args);
  try {
    switch (toolName) {
      case 'bash': {
        try {
          const output = execSync(String(safeArgs.command || ''), {
            cwd: cwd,
            encoding: 'utf-8',
            timeout: 60000,
            maxBuffer: 1024 * 1024 * 10
          });
          return output || '(command completed with no output)';
        } catch (e) {
          return `Error: ${e.message}\n${e.stderr || ''}`;
        }
      }
      case 'read_file': {
        const filePath = path.isAbsolute(safeArgs.path) ? safeArgs.path : path.join(cwd, safeArgs.path);
        if (!fs.existsSync(filePath)) {
          return `Error: File not found: ${filePath}`;
        }
        if (path.extname(filePath).toLowerCase() === '.pdf') {
          return await readPdfText(filePath);
        }
        return fs.readFileSync(filePath, 'utf-8');
      }
      case 'read_pdf': {
        const filePath = path.isAbsolute(safeArgs.path) ? safeArgs.path : path.join(cwd, safeArgs.path);
        if (!fs.existsSync(filePath)) {
          return `Error: File not found: ${filePath}`;
        }
        if (path.extname(filePath).toLowerCase() !== '.pdf') {
          return `Error: Not a PDF file: ${filePath}`;
        }
        return await readPdfText(filePath);
      }
      case 'write_file': {
        const filePath = path.isAbsolute(safeArgs.path) ? safeArgs.path : path.join(cwd, safeArgs.path);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, String(safeArgs.content || ''), 'utf-8');
        return `File written: ${filePath}`;
      }
      case 'list_files': {
        const dirPath = path.isAbsolute(safeArgs.path) ? safeArgs.path : path.join(cwd, safeArgs.path);
        if (!fs.existsSync(dirPath)) {
          return `Error: Directory not found: ${dirPath}`;
        }
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        return items.map(item => `${item.isDirectory() ? '[dir] ' : ''}${item.name}`).join('\n');
      }
      case 'tavily_search': {
        const apiKey = (configStore && configStore.getTavilyApiKey()) || process.env.TAVILY_API_KEY;
        if (!apiKey) {
          return 'Error: Tavily API key not set. Add it via the AI menu → Set Tavily API Key...';
        }

        try {
          const https = require('https');
          const maxResults = safeArgs.max_results || 5;

          const requestBody = JSON.stringify({
            api_key: apiKey,
            query: safeArgs.query,
            search_depth: 'basic',
            max_results: maxResults,
            include_answer: true
          });

          return await new Promise((resolve, reject) => {
            const req = https.request({
              hostname: 'api.tavily.com',
              port: 443,
              path: '/search',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
              }
            }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                try {
                  const result = JSON.parse(data);

                  if (result.error) {
                    resolve(`Error from Tavily: ${result.error}`);
                    return;
                  }

                  // Format results nicely
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
            });

            req.on('error', (err) => {
              resolve(`Error calling Tavily API: ${err.message}`);
            });

            req.write(requestBody);
            req.end();
          });
        } catch (e) {
          return `Error: ${e.message}`;
        }
      }
      default:
        return `Error: Unknown tool: ${toolName}`;
    }
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

// Provider-agnostic streaming chat. Delegates to aiProviders.streamChat which
// handles both Ollama (/api/chat) and OpenAI-compatible (/v1/chat/completions)
// endpoints and normalizes the returned assistant message + tool_calls shape.
function streamProviderChat(cfg, messages, tools, sendOutput, abortCheck) {
  return aiProviders.streamChat({
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    messages,
    tools,
    onContent: (chunk) => sendOutput('claude-output', chunk),
    isAborted: abortCheck
  });
}

const MAX_HISTORY = 40;

/**
 * Register agent IPC handlers.
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ state: import('../../services/sessionState').SessionState, bus: import('../rendererBus').RendererBus, configStore: typeof import('../../services/configStore'), terminalService: ReturnType<import('./terminal').createTerminalService> }} deps
 */
function registerHandlers(ipcMain, { state, bus, configStore, terminalService }) {
  // Broadcast helper — sends to both the main window and the detached terminal
  // window so that streamed agent output shows up wherever the user is looking.
  const sendOutput = terminalService
    ? (channel, ...args) => terminalService.syncTerminalOutput(channel, ...args)
    : (channel, ...args) => bus.send(channel, ...args);
  // Cache for model context lengths
  const modelContextCache = {};

  // Get model context length from Ollama
  async function getModelContextLength(modelName) {
    if (modelContextCache[modelName]) return modelContextCache[modelName];
    try {
      const requestBody = JSON.stringify({ name: modelName });
      const result = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: 11434,
          path: '/api/show',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody)
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              const info = json.model_info || {};
              // Look for context_length in model_info keys
              for (const key of Object.keys(info)) {
                if (key.toLowerCase().includes('context_length')) {
                  resolve(info[key]);
                  return;
                }
              }
              resolve(32768); // Default fallback
            } catch (e) {
              resolve(32768);
            }
          });
        });
        req.on('error', () => resolve(32768));
        req.write(requestBody);
        req.end();
      });
      modelContextCache[modelName] = result;
      return result;
    } catch (e) {
      return 32768;
    }
  }

  // Query an OpenAI-compatible /v1/models endpoint for context length.
  // MLX and many other servers expose this as `max_model_len` or similar.
  async function getOpenAIModelContextLength(baseUrl, modelName) {
    const cacheKey = `openai:${baseUrl}:${modelName}`;
    if (modelContextCache[cacheKey]) return modelContextCache[cacheKey];
    try {
      const url = new URL('/v1/models', baseUrl);
      const result = await new Promise((resolve, reject) => {
        const mod = url.protocol === 'https:' ? require('https') : http;
        const req = mod.request(url, { method: 'GET' }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              const models = json.data || [];
              const match = models.find(m => m.id === modelName);
              if (match) {
                // MLX uses max_model_len; others may use context_length or context_window
                const ctx = match.max_model_len || match.context_length || match.context_window;
                if (ctx && typeof ctx === 'number' && ctx > 0) {
                  resolve(ctx);
                  return;
                }
              }
              resolve(null);
            } catch (e) {
              resolve(null);
            }
          });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(3000, () => { req.destroy(); resolve(null); });
        req.end();
      });
      if (result) {
        modelContextCache[cacheKey] = result;
        return result;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // Context health stats IPC
  ipcMain.handle('get-context-stats', async () => {
    const model = configStore.getActiveModel();
    const history = state.agentConversationHistory;
    const messageCount = history.length;
    const estimatedTokens = estimateTokens(history);

    // Pick the context limit per active provider:
    // - Ollama: query /api/show for context_length
    // - OpenAI-compatible: try /v1/models auto-detection first, then fall back
    //   to the user-configured contextLength, then 32k default.
    let contextLimit;
    if (configStore.getAIProvider() === 'ollama') {
      contextLimit = model ? await getModelContextLength(model) : 32768;
    } else {
      const ep = configStore.getActiveOpenAIEndpoint();
      const baseUrl = ep && ep.baseUrl;
      // Try auto-detection from the endpoint
      const detected = baseUrl && model
        ? await getOpenAIModelContextLength(baseUrl, model)
        : null;
      if (detected) {
        contextLimit = detected;
      } else if (ep && typeof ep.contextLength === 'number' && ep.contextLength > 0) {
        contextLimit = ep.contextLength;
      } else {
        contextLimit = 32768;
      }
    }

    return {
      model: model || 'none',
      messageCount,
      estimatedTokens,
      contextLimit,
      usagePercent: Math.round((estimatedTokens / contextLimit) * 100)
    };
  });

  // Agent execution with streaming and tool calling, provider-agnostic.
  ipcMain.handle('agent-execute', async (event, prompt, cwd) => {
    const cfg = aiProviders.getActiveProviderConfig(configStore);

    if (cfg.provider === aiProviders.PROVIDER_OLLAMA) {
      if (!state.availableAITools.ollama) {
        sendOutput('claude-error', 'Ollama is not installed. Install it from https://ollama.ai\n');
        sendOutput('claude-done', 1);
        return 1;
      }
      if (state.availableAITools.ollamaModels.length === 0) {
        sendOutput('claude-error', 'No Ollama models found. Run: ollama pull llama3.2\n');
        sendOutput('claude-done', 1);
        return 1;
      }
    }

    if (!cfg.model) {
      const hint = cfg.provider === 'openai-compatible'
        ? 'Configure it via AI menu → Configure OpenAI-Compatible Endpoint…'
        : 'Select one from the AI menu.';
      sendOutput('claude-error', `No AI model selected. ${hint}\n`);
      sendOutput('claude-done', 1);
      return 1;
    }

    state.agentAborted = false;
    const workingDir = cwd || process.env.HOME;

    // Check for /clear command to reset conversation
    if (prompt.trim().toLowerCase() === 'clear' || prompt.trim().toLowerCase() === '/clear') {
      state.agentConversationHistory = [];
      bus.send('context-stats-updated');
      bus.sendToTerminal('context-stats-updated');
      sendOutput('claude-output', 'Conversation history cleared.\n');
      sendOutput('claude-done', 0);
      return 0;
    }

    // Build messages array - include conversation history for context
    const today = new Date().toISOString().split('T')[0];
    const systemMessage = {
      role: 'system',
      content: `You are a helpful assistant with access to tools. Use tools to help the user accomplish tasks. The current working directory is: ${workingDir}. Today's date is ${today}.

When you need to run commands, read files, write files, or list directories, use the appropriate tool.
When the user asks about a PDF or provides a .pdf path, use read_pdf or read_file to extract the document text directly. Do not look for pdftotext, Python PDF libraries, or other external PDF utilities first.
When the user asks you to search the internet, look up current information, find recent news, or uses words like "zoek", "search", "latest", "recent", or "news", ALWAYS use the tavily_search tool — do not answer from memory.
After using tools, provide a summary of what you did. You have access to conversation history, so you can answer follow-up questions about previous results.`
    };

    // Start with system message, then history, then new prompt
    const messages = [systemMessage, ...state.agentConversationHistory, { role: 'user', content: prompt }];

    // Add user message to history
    state.agentConversationHistory.push({ role: 'user', content: prompt });

    try {
      let iterations = 0;
      const maxIterations = 20; // Prevent infinite loops
      let lastMetrics = null;

      while (iterations < maxIterations && !state.agentAborted) {
        iterations++;

        // Stream a chat completion from whichever provider is active.
        const assistantMessage = await streamProviderChat(
          cfg, messages, agentTools, sendOutput,
          () => state.agentAborted
        );

        if (!assistantMessage) {
          throw new Error('No response from model');
        }
        if (assistantMessage.metrics) lastMetrics = assistantMessage.metrics;

        // Add assistant message to messages for multi-turn tool loop
        messages.push(assistantMessage);

        // Check if the model wants to call tools (native format)
        let toolCalls = assistantMessage.tool_calls || [];

        // Also check for JSON tool calls in text content (some models output this way)
        if (toolCalls.length === 0 && assistantMessage.content) {
          const jsonMatch = assistantMessage.content.match(/\{[\s\S]*"name"[\s\S]*"parameters"[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              const toolName = parsed.name === 'Execute a shell command and return the output' ? 'bash' :
                              parsed.name === 'Read the contents of a file' ? 'read_file' :
                              parsed.name === 'Extract readable text from a PDF document so it can be summarized or analyzed' ? 'read_pdf' :
                              parsed.name === 'Write content to a file' ? 'write_file' :
                              parsed.name === 'List files and directories in a path' ? 'list_files' :
                              parsed.name;

              let toolArgs = parsed.parameters || parsed.arguments || {};
              if (toolArgs.command && Array.isArray(toolArgs.command)) {
                toolArgs = { command: toolArgs.command.join(' ') };
              }

              toolCalls = [{
                function: {
                  name: toolName,
                  arguments: toolArgs
                }
              }];
            } catch (e) {
              // Not valid JSON, treat as regular output
            }
          }
        }

        if (toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            if (state.agentAborted) break;

            const toolName = toolCall.function.name;
            const toolArgs = normalizeToolArguments(toolCall.function.arguments);

            // Show tool call in terminal
            sendOutput('claude-output', `\n▶ ${toolName}: ${JSON.stringify(toolArgs)}\n`);

            // Execute the tool
            const toolResult = await executeAgentTool(toolName, toolArgs, workingDir, configStore);

            // Show result (truncated if too long)
            const displayResult = toolResult.length > 2000
              ? toolResult.substring(0, 2000) + '\n... (truncated)'
              : toolResult;
            sendOutput('claude-output', `${displayResult}\n`);

            // Add tool result to messages (for current loop). OpenAI-compatible
            // providers require a tool_call_id; aiProviders handles that.
            messages.push(aiProviders.formatToolResultMessage(cfg.provider, toolCall, toolResult));

            // Save tool call and result to conversation history
            state.agentConversationHistory.push({
              role: 'assistant',
              content: `[Used ${toolName}: ${JSON.stringify(toolArgs)}]\n\nResult:\n${toolResult.substring(0, 1000)}${toolResult.length > 1000 ? '...' : ''}`
            });
          }
        } else {
          // No tool calls - model is done, save final response to history
          if (assistantMessage.content) {
            state.agentConversationHistory.push({
              role: 'assistant',
              content: assistantMessage.content
            });
          }
          break;
        }
      }

      if (iterations >= maxIterations) {
        sendOutput('claude-output', '\n(Reached maximum iterations)\n');
      }

      // Limit conversation history to prevent context overflow
      if (state.agentConversationHistory.length > MAX_HISTORY) {
        state.agentConversationHistory = state.agentConversationHistory.slice(-MAX_HISTORY);
      }

      // Notify renderer to update context stats
      bus.send('context-stats-updated');
      bus.sendToTerminal('context-stats-updated');
      if (lastMetrics) sendOutput('claude-metrics', lastMetrics);
      sendOutput('claude-done', 0);
      return 0;
    } catch (e) {
      sendOutput('claude-error', `Agent error: ${e.message}\n`);
      sendOutput('claude-done', 1);
      return 1;
    }
  });

  // Agent execution that researches the web (and other tools) and returns the
  // final document content for /write-new. Tool activity streams to the terminal
  // via 'claude-output'; the resolved value is the clean document body to insert
  // into the editor. Does NOT touch agent conversation history (one-shot).
  ipcMain.handle('agent-execute-editor', async (event, prompt, cwd) => {
    const cfg = aiProviders.getActiveProviderConfig(configStore);

    if (cfg.provider === aiProviders.PROVIDER_OLLAMA) {
      if (!state.availableAITools.ollama) {
        sendOutput('claude-error', 'Ollama is not installed. Install it from https://ollama.ai\n');
        sendOutput('claude-done', 1);
        return '';
      }
      if (state.availableAITools.ollamaModels.length === 0) {
        sendOutput('claude-error', 'No Ollama models found. Run: ollama pull llama3.2\n');
        sendOutput('claude-done', 1);
        return '';
      }
    }

    if (!cfg.model) {
      const hint = cfg.provider === 'openai-compatible'
        ? 'Configure it via AI menu → Configure OpenAI-Compatible Endpoint…'
        : 'Select one from the AI menu.';
      sendOutput('claude-error', `No AI model selected. ${hint}\n`);
      sendOutput('claude-done', 1);
      return '';
    }

    state.agentAborted = false;
    const workingDir = cwd || process.env.HOME;
    const today = new Date().toISOString().split('T')[0];

    const systemMessage = {
      role: 'system',
      content: `You are a research-and-writing assistant with web access. The current working directory is: ${workingDir}. Today's date is ${today}.

ALWAYS use the tavily_search tool to gather the latest, most accurate information BEFORE writing — do not rely on memory, as it may be outdated.

After researching, output ONLY the final document body in GitHub-Flavored Markdown. Do NOT include a preamble, a description of your steps, or a summary of what you did. Do NOT wrap the document in code fences. Do NOT add YAML frontmatter (the editor adds it). Use tables, headings, and lists where they improve clarity.`
    };

    const messages = [systemMessage, { role: 'user', content: prompt }];

    // Suppress the model's streamed prose from the terminal — it lands in the
    // editor instead. Tool announcements/results (sent directly below) stay
    // visible so the user can watch the research happen.
    const quietOutput = (channel, ...args) => {
      if (channel === 'claude-output') return;
      sendOutput(channel, ...args);
    };

    try {
      let iterations = 0;
      const maxIterations = 20;
      let finalContent = '';
      let lastMetrics = null;

      while (iterations < maxIterations && !state.agentAborted) {
        iterations++;

        const assistantMessage = await streamProviderChat(
          cfg, messages, agentTools, quietOutput,
          () => state.agentAborted
        );

        if (!assistantMessage) {
          throw new Error('No response from model');
        }
        if (assistantMessage.metrics) lastMetrics = assistantMessage.metrics;

        messages.push(assistantMessage);

        let toolCalls = assistantMessage.tool_calls || [];

        if (toolCalls.length === 0 && assistantMessage.content) {
          const jsonMatch = assistantMessage.content.match(/\{[\s\S]*"name"[\s\S]*"parameters"[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              let toolArgs = parsed.parameters || parsed.arguments || {};
              if (toolArgs.command && Array.isArray(toolArgs.command)) {
                toolArgs = { command: toolArgs.command.join(' ') };
              }
              toolCalls = [{ function: { name: parsed.name, arguments: toolArgs } }];
            } catch (e) {
              // Not valid JSON — treat as final content
            }
          }
        }

        if (toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            if (state.agentAborted) break;
            const toolName = toolCall.function.name;
            const toolArgs = normalizeToolArguments(toolCall.function.arguments);
            sendOutput('claude-output', `\n▶ ${toolName}: ${JSON.stringify(toolArgs)}\n`);
            const toolResult = await executeAgentTool(toolName, toolArgs, workingDir, configStore);
            const displayResult = toolResult.length > 2000
              ? toolResult.substring(0, 2000) + '\n... (truncated)'
              : toolResult;
            sendOutput('claude-output', `${displayResult}\n`);
            messages.push(aiProviders.formatToolResultMessage(cfg.provider, toolCall, toolResult));
          }
        } else {
          // No tool calls — this is the final document.
          finalContent = assistantMessage.content || '';
          break;
        }
      }

      if (iterations >= maxIterations) {
        sendOutput('claude-output', '\n(Reached maximum iterations)\n');
      }

      bus.send('context-stats-updated');
      bus.sendToTerminal('context-stats-updated');
      if (lastMetrics) sendOutput('claude-metrics', lastMetrics);
      sendOutput('claude-done', 0);
      return finalContent;
    } catch (e) {
      sendOutput('claude-error', `Agent error: ${e.message}\n`);
      sendOutput('claude-done', 1);
      return '';
    }
  });

  // Clear agent conversation history
  ipcMain.handle('agent-clear-history', () => {
    state.agentConversationHistory = [];
    bus.send('context-stats-updated');
    bus.sendToTerminal('context-stats-updated');
  });
}

module.exports = { registerHandlers };

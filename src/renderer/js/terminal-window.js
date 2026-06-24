// Terminal Window — Standalone detached terminal

(function() {
  'use strict';

  // Simple state for detached terminal
  const terminalState = {
    activeTerminalTab: 'ai',
    isClaudeRunning: false,
    isShellRunning: false,
    terminalHistory: [],
    terminalHistoryIndex: 0,
    basePath: null,
    projectRoot: null,
    currentDirectory: null,
    currentFilePath: null
  };

  // Picker state for command autocomplete
  const pickerState = { active: false, items: [], selectedIndex: 0, blockEl: null };

  // DOM elements
  const terminalOutput = document.getElementById('terminal-output');
  const terminalInput = document.getElementById('terminal-input');
  const terminalContextBar = document.getElementById('terminal-context-bar');
  const terminalClear = document.getElementById('terminal-clear');
  const terminalStop = document.getElementById('terminal-stop');
  const terminalReattach = document.getElementById('terminal-reattach');
  const aiTerminalContent = document.getElementById('ai-terminal-content');
  const shellTerminalContent = document.getElementById('shell-terminal-content');
  const shellTerminalContainer = document.getElementById('shell-terminal-container');
  const terminalTabs = document.querySelectorAll('.terminal-tab');

  // xterm state
  let xterm = null;
  let xtermFitAddon = null;

  // --- Terminal tab switching ---

  function switchTerminalTab(tabName) {
    terminalState.activeTerminalTab = tabName;

    // Update tab buttons
    terminalTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.terminal === tabName);
    });

    // Update content visibility
    aiTerminalContent.classList.toggle('active', tabName === 'ai');
    shellTerminalContent.classList.toggle('active', tabName === 'shell');

    // Sync to main window
    window.vomit.syncTerminalTab(tabName);

    // Focus appropriate element
    if (tabName === 'ai') {
      terminalInput.focus();
    } else if (tabName === 'shell') {
      initXterm();
      if (!terminalState.isShellRunning) {
        startShell();
      }
      setTimeout(() => {
        if (xtermFitAddon) {
          xtermFitAddon.fit();
        }
        if (xterm) {
          xterm.focus();
        }
      }, 0);
    }
  }

  // --- Shell terminal (xterm.js) ---

  function getXtermTheme() {
    const styles = getComputedStyle(document.body);
    const bgPrimary = styles.getPropertyValue('--bg-primary').trim() || '#1e1e1e';
    const textPrimary = styles.getPropertyValue('--text-primary').trim() || '#d4d4d4';

    return {
      background: bgPrimary,
      foreground: textPrimary,
      cursor: textPrimary,
      cursorAccent: bgPrimary,
      selectionBackground: 'rgba(255, 255, 255, 0.3)',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#e5e5e5'
    };
  }

  function initXterm() {
    if (xterm) return;

    xterm = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: getXtermTheme(),
      scrollback: 10000
    });

    xtermFitAddon = new FitAddon.FitAddon();
    xterm.loadAddon(xtermFitAddon);

    xterm.open(shellTerminalContainer);
    xtermFitAddon.fit();

    // Handle terminal input
    xterm.onData((data) => {
      if (terminalState.isShellRunning) {
        window.vomit.shellWrite(data);
      }
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      if (xtermFitAddon) {
        xtermFitAddon.fit();
        if (terminalState.isShellRunning) {
          window.vomit.shellResize(xterm.cols, xterm.rows);
        }
      }
    });
  }

  async function startShell() {
    const cwd = terminalState.basePath || null;
    const exitCode = await window.vomit.shellSpawn(cwd);
    if (exitCode === 0) {
      terminalState.isShellRunning = true;
      setTimeout(() => {
        if (xtermFitAddon && terminalState.isShellRunning) {
          xtermFitAddon.fit();
          window.vomit.shellResize(xterm.cols, xterm.rows);
        }
      }, 100);
    }
  }

  function appendShellOutput(data) {
    if (xterm) {
      xterm.write(data);
    }
  }

  function clearShellTerminal() {
    if (xterm) {
      xterm.clear();
    }
  }

  // --- Command picker (autocomplete) ---

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function openPicker(inputValue) {
    const { COMMAND_REGISTRY } = window.TerminalCommands;
    const lower = inputValue.toLowerCase();
    const trimmedLower = lower.trim();
    let filtered;

    // Hint mode: exact command name followed by a trailing space (after Tab completion)
    if (inputValue.endsWith(' ') && trimmedLower.startsWith('/')) {
      const exact = COMMAND_REGISTRY.find(c => c.name.toLowerCase() === trimmedLower);
      if (exact && exact.args !== 'none') {
        filtered = [exact];
      } else {
        closePicker();
        return;
      }
    } else {
      filtered = [...COMMAND_REGISTRY]
        .filter(c => c.name.toLowerCase().startsWith(lower))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    if (filtered.length === 0) {
      closePicker();
      return;
    }

    pickerState.selectedIndex = 0;
    pickerState.items = filtered;
    pickerState.active = true;
    renderPicker();
  }

  function closePicker() {
    if (pickerState.blockEl) {
      pickerState.blockEl.remove();
      pickerState.blockEl = null;
    }
    pickerState.active = false;
    pickerState.items = [];
    pickerState.selectedIndex = 0;
  }

  function renderPicker() {
    const { items, selectedIndex } = pickerState;
    const maxLen = Math.max(...items.map(c => c.name.length));
    const maxHintLen = Math.max(0, ...items.map(c => (c.argsHint || '').length));
    const showArgs = maxHintLen > 0;

    if (!pickerState.blockEl) {
      const el = document.createElement('div');
      el.className = 'terminal-picker-block';
      terminalOutput.appendChild(el);
      pickerState.blockEl = el;
    }

    pickerState.blockEl.innerHTML = items.map((c, i) => {
      const isSelected = i === selectedIndex;
      const marker = isSelected ? '▸' : ' ';
      const name = c.name.padEnd(maxLen);
      const argsStr = showArgs ? `  ${(c.argsHint || '').padEnd(maxHintLen)}` : '';
      const cls = isSelected ? 'terminal-line system terminal-picker-selected' : 'terminal-line system';
      const text = ` ${marker} ${name}${argsStr}  —  ${c.description}`;
      return `<div class="${cls}" style="white-space:pre">${escapeHtml(text)}</div>`;
    }).join('');

    // Scroll the selected row into view rather than always jumping to bottom
    const selectedEl = pickerState.blockEl.querySelector('.terminal-picker-selected');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function pickerMoveSelection(delta) {
    const n = pickerState.items.length;
    pickerState.selectedIndex = (pickerState.selectedIndex + delta + n) % n;
    renderPicker();
  }

  // --- AI terminal output ---
  let terminalMarkedOptions = null;

  // Configure marked.js for proper markdown rendering
  function configureMarked() {
    if (!window.marked || !window.hljs) return;

    const renderer = new marked.Renderer();

    // Custom code block renderer with syntax highlighting
    renderer.code = function(tokenOrCode, language) {
      const code = typeof tokenOrCode === 'object' && tokenOrCode !== null
        ? tokenOrCode.text || ''
        : String(tokenOrCode || '');
      const lang = typeof tokenOrCode === 'object' && tokenOrCode !== null
        ? tokenOrCode.lang
        : language;
      if (lang && window.hljs.getLanguage(lang)) {
        try {
          const highlighted = window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
          return `<pre><code class="hljs language-${escapeHtml(lang)}">${highlighted}</code></pre>`;
        } catch (e) {
          // Fallback to auto-detect
        }
      }
      const autoDetected = window.hljs.highlightAuto(code);
      return `<pre><code class="hljs">${autoDetected.value}</code></pre>`;
    };

    // Escape HTML in text to prevent XSS
    renderer.html = function(html) {
      const text = typeof html === 'object' && html !== null ? html.text || '' : String(html || '');
      return escapeHtml(text);
    };

    renderer.codespan = function(tokenOrCode) {
      const code = typeof tokenOrCode === 'object' && tokenOrCode !== null
        ? tokenOrCode.text || ''
        : String(tokenOrCode || '');
      return `<code>${escapeHtml(code)}</code>`;
    };

    function escapeHtml(value) {
      const div = document.createElement('div');
      div.textContent = value;
      return div.innerHTML;
    }

    terminalMarkedOptions = {
      renderer: renderer,
      breaks: false,      // Don't convert \n to <br> — markdown handles spacing
      gfm: true,          // GitHub Flavored Markdown
      headerIds: false,   // Don't generate header IDs
      mangle: false,      // Don't mangle email addresses
      sanitize: false     // Allow HTML (AI responses are from trusted local source)
    };
  }

  function normalizeTerminalText(value) {
    if (typeof value === 'string') return value;
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(normalizeTerminalText).join('');
    if (typeof value === 'object') {
      if (typeof value.text === 'string') return value.text;
      if (typeof value.content === 'string') return value.content;
      if (typeof value.value === 'string') return value.value;
      try {
        return JSON.stringify(value);
      } catch {
        return '';
      }
    }
    return String(value);
  }

  function appendTerminalOutput(text, type = 'output') {
    text = normalizeTerminalText(text);
    // Streaming AI output arrives one token at a time. To avoid each token
    // landing on its own line (each div is block-level), aggregate the
    // stream into a single .terminal-output-stream element and only render
    // markdown once the stream completes (markOutputComplete).
    if (type === 'output' || type === 'agent-output') {
      let outputDiv = terminalOutput.querySelector('.terminal-output-stream:not(.complete)');
      if (!outputDiv) {
        outputDiv = document.createElement('div');
        outputDiv.className = 'terminal-line terminal-output-stream output';
        terminalOutput.appendChild(outputDiv);
      }
      outputDiv.textContent += text;
      if (pickerState.active && pickerState.blockEl) {
        terminalOutput.appendChild(pickerState.blockEl);
      }
      terminalOutput.scrollTop = terminalOutput.scrollHeight;
      return;
    }

    const div = document.createElement('div');
    // Match the main TerminalManager's class convention so the shared
    // .terminal-line.input/.output/.error/.system color rules apply.
    div.className = `terminal-line ${type}`;
    div.textContent = text;
    terminalOutput.appendChild(div);
    if (pickerState.active && pickerState.blockEl) {
      terminalOutput.appendChild(pickerState.blockEl);
    }
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }

  function renderMarkdownInto(element) {
    const text = element.textContent;
    if (!text.trim()) return;

    try {
      const html = marked.parse(text, terminalMarkedOptions || undefined);
      element.innerHTML = html;

      element.querySelectorAll('pre code').forEach((block) => {
        if (window.hljs) hljs.highlightElement(block);
      });

      if (window.renderMathInElement) {
        renderMathInElement(element, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false }
          ],
          throwOnError: false
        });
      }
    } catch (e) {
      console.error('Markdown rendering error:', e);
      element.textContent = text;
    }
  }

  function markOutputComplete() {
    const outputStream = terminalOutput.querySelector('.terminal-output-stream:not(.complete)');
    if (outputStream) {
      outputStream.classList.add('complete');
      renderMarkdownInto(outputStream);
    }
  }

  function clearTerminal() {
    closePicker();
    terminalOutput.innerHTML = '';
  }

  function showAvailableCommands() {
    const { COMMAND_REGISTRY } = window.TerminalCommands;
    appendTerminalOutput('Available commands:', 'system');
    COMMAND_REGISTRY.forEach(c => {
      const args = c.argsHint ? ` ${c.argsHint}` : '';
      appendTerminalOutput(`  ${c.name}${args}  —  ${c.description}`, 'system');
    });
    appendTerminalOutput('', 'system');
  }

  async function updateContextBar() {
    if (!terminalContextBar) return;
    try {
      const stats = await window.vomit.getContextStats();
      if (!stats || stats.model === 'none' || stats.messageCount === 0) {
        terminalContextBar.classList.remove('visible', 'level-ok', 'level-warn', 'level-danger');
        return;
      }

      const pct = stats.usagePercent;
      const level = pct >= 75 ? 'danger' : pct >= 50 ? 'warn' : 'ok';
      const tokensK = (stats.estimatedTokens / 1000).toFixed(1);
      const limitK = (stats.contextLimit / 1000).toFixed(0);

      terminalContextBar.classList.add('visible');
      terminalContextBar.classList.remove('level-ok', 'level-warn', 'level-danger');
      terminalContextBar.classList.add(`level-${level}`);

      let hint = '';
      if (pct >= 75) hint = ' — consider /new to clear';
      else if (pct >= 50) hint = ' — getting full';

      terminalContextBar.innerHTML =
        `<span>${stats.model}</span>` +
        `<span>${stats.messageCount} messages · ~${tokensK}K/${limitK}K tokens</span>` +
        `<span class="context-usage"><span class="context-usage-fill" style="width:${Math.min(pct, 100)}%"></span></span>` +
        `<span>${pct}%${hint}</span>`;
    } catch (e) {
      // Silently fail — stats are informational only
    }
  }

  async function updateTerminalTitle() {
    try {
      const titleEl = document.querySelector('.terminal-title');
      if (!titleEl || !window.vomit.getAIProvider) return;
      const aiInfo = await window.vomit.getAIProvider();
      if (aiInfo && aiInfo.provider === 'ollama') {
        titleEl.textContent = `Ollama: ${aiInfo.model}`;
      } else {
        titleEl.textContent = 'Claude Terminal';
      }
    } catch (e) {
      // Title is informational only.
    }
  }

  // --- Command execution ---

  // Commands that need to mutate the editor or read live host state
  // (CodeMirror selection, doc length, write streaming target). The detached
  // window has no host of its own, so it forwards the raw command back to
  // the main TerminalManager and shows the streamed output (which is
  // broadcast to both windows by terminalService.syncTerminalOutput).
  const EDITOR_COMMANDS = new Set([
    '/write',
    '/write-new',
    '/rewrite',
    '/format-to-md',
    '/append',
    '/presentation',
    '/pseudo',
    '/pseudo all',
    '/depseudo'
  ]);

  function persistHistory() {
    if (window.vomit && window.vomit.setTerminalHistory) {
      window.vomit.setTerminalHistory(terminalState.terminalHistory);
    }
  }

  // Helper: /doc — fetch live editor content from the main window and run
  // the prompt with that doc inlined. Mirrors features/terminal.js.
  async function executeDocCommand(prompt, cwd) {
    try {
      const editorData = await window.vomit.getEditorContent();

      if (!editorData || !editorData.content) {
        appendTerminalOutput('Error: No document is currently open in the main window.', 'error');
        terminalState.isClaudeRunning = false;
        terminalStop.classList.add('hidden');
        return;
      }

      const finalCommand = `Here is the document I'm working on:\n\n---\n${editorData.content}\n---\n\nUser request: ${prompt}`;
      appendTerminalOutput(`❯ ${prompt} (with document context)`, 'input');
      window.vomit.syncTerminalInput(`/doc ${prompt}`);

      terminalState.isClaudeRunning = true;
      terminalStop.classList.remove('hidden');

      await window.vomit.agentExecute(finalCommand, cwd);
    } catch (err) {
      appendTerminalOutput(`Error: ${err.message}`, 'error');
      terminalState.isClaudeRunning = false;
      terminalStop.classList.add('hidden');
    }
  }

  // Helper: /agent — plain agent execution with tools + shared history.
  async function executeAgentCommand(prompt, cwd) {
    appendTerminalOutput(`❯ /agent ${prompt}`, 'input');
    appendTerminalOutput('Running in agent mode with tools...', 'system');
    window.vomit.syncTerminalInput(`/agent ${prompt}`);

    terminalState.isClaudeRunning = true;
    terminalStop.classList.remove('hidden');

    try {
      await window.vomit.agentExecute(prompt, cwd);
    } catch (err) {
      appendTerminalOutput(`Error: ${err.message}`, 'error');
      terminalState.isClaudeRunning = false;
      terminalStop.classList.add('hidden');
    }
  }

  // Helper: /index — kick off RAG indexing for current bucket or subpath.
  async function indexFolderForRAG(projectRoot, targetPath, subpath) {
    const displayPath = subpath ? `/index ${subpath}` : '/index';
    appendTerminalOutput(`❯ ${displayPath}`, 'input');
    appendTerminalOutput(
      subpath
        ? `Refreshing ${subpath} in the bucket RAG index...`
        : 'Indexing current bucket for RAG...',
      'system'
    );
    appendTerminalOutput('This requires the nomic-embed-text model. Run: ollama pull nomic-embed-text', 'system');

    try {
      const result = await window.vomit.ragIndex(projectRoot, targetPath);
      if (result.success) {
        appendTerminalOutput(`✓ Bucket index updated! ${result.indexed} chunks from ${result.files} files.`, 'output');
        appendTerminalOutput('Use /rag <query> to search the current bucket with context.', 'system');
      } else {
        appendTerminalOutput(`✗ Indexing failed: ${result.error}`, 'error');
      }
    } catch (err) {
      appendTerminalOutput(`Error: ${err.message}`, 'error');
    }
  }

  async function reindexRAG(cwd) {
    appendTerminalOutput('❯ /reindex', 'input');
    appendTerminalOutput('Clearing current bucket RAG index...', 'system');

    try {
      const clearResult = await window.vomit.ragClear(cwd);
      if (!clearResult.success) {
        appendTerminalOutput(`✗ Cleanup failed: ${clearResult.error}`, 'error');
        return;
      }

      const removed = clearResult.deleted > 0
        ? `Removed ${clearResult.deleted} database file${clearResult.deleted === 1 ? '' : 's'}.`
        : 'No existing RAG database found.';
      appendTerminalOutput(removed, 'system');
      appendTerminalOutput('Rebuilding full bucket index...', 'system');
      appendTerminalOutput('This requires the nomic-embed-text model. Run: ollama pull nomic-embed-text', 'system');

      const result = await window.vomit.ragIndex(cwd, cwd);
      if (result.success) {
        appendTerminalOutput(`✓ Reindex complete! ${result.indexed} chunks from ${result.files} files.`, 'output');
        appendTerminalOutput('Use /rag <query> to search the current bucket with fresh context.', 'system');
      } else {
        appendTerminalOutput(`✗ Reindex failed: ${result.error}`, 'error');
      }
    } catch (err) {
      appendTerminalOutput(`Error: ${err.message}`, 'error');
    }
  }

  async function searchWithRAG(query, cwd) {
    appendTerminalOutput(`❯ /rag ${query}`, 'input');

    try {
      const results = await window.vomit.ragSearch(query, cwd);

      if (!results.success) {
        if (results.error === 'not_indexed') {
          appendTerminalOutput('No bucket index found. Run /index first to index the current bucket.', 'error');
        } else {
          appendTerminalOutput(`Search failed: ${results.error}`, 'error');
        }
        return;
      }

      if (results.chunks.length === 0) {
        appendTerminalOutput('No relevant context found. Try a different query.', 'system');
        return;
      }

      appendTerminalOutput(`Found ${results.chunks.length} relevant chunks. Querying AI...`, 'system');

      const contextParts = results.chunks.map((chunk) => {
        const tag = chunk.source === 'wikilink' ? ' (via wikilink)' : '';
        return `[Source: ${chunk.file}${tag}]\n${chunk.content}`;
      });
      const context = contextParts.join('\n\n---\n\n');

      const ragPrompt = `You are a helpful assistant. Answer the user's question based on the following context from their bucket files.

Context from bucket:
---
${context}
---

User question: ${query}

Provide a helpful, accurate answer based on the context above. If the context doesn't contain relevant information, say so.`;

      terminalState.isClaudeRunning = true;
      terminalStop.classList.remove('hidden');

      await window.vomit.agentExecute(ragPrompt, cwd);
    } catch (err) {
      appendTerminalOutput(`Error: ${err.message}`, 'error');
    }
  }

  async function reindexWiki(cwd) {
    appendTerminalOutput('❯ /wiki reindex', 'input');
    appendTerminalOutput('Rebuilding wikilink index for current bucket...', 'system');
    try {
      const result = await window.vomit.wikiIndex(cwd);
      if (result.success) {
        const broken = result.brokenLinks > 0
          ? ` (${result.brokenLinks} broken)`
          : '';
        appendTerminalOutput(
          `✓ Wiki index built: ${result.linksIndexed} links across ${result.filesProcessed} notes${broken}.`,
          'output'
        );
      } else {
        appendTerminalOutput(`✗ Wiki index failed: ${result.error}`, 'error');
      }
    } catch (err) {
      appendTerminalOutput(`Error: ${err.message}`, 'error');
    }
  }

  // Forward an editor-mutating command to the main window's TerminalManager.
  // The main TerminalManager will run it normally; output streams back to
  // both windows via the shared claude-output/claude-done broadcast.
  // We don't call syncTerminalInput here because the main listener for
  // execute-detached-command already echoes the input line, and we'd
  // otherwise print it twice.
  function forwardEditorCommand(command) {
    appendTerminalOutput(`❯ ${command}`, 'input');
    appendTerminalOutput('Forwarding to main window (this command needs the editor)…', 'system');
    window.vomit.executeInMainTerminal(command);
  }

  async function executeClaudeCommand(command) {
    const { parseCommand, dispatchCommand } = window.TerminalCommands;
    const parsed = parseCommand(command);

    // Mock TerminalManager interface for the shared command registry.
    // For commands that operate purely via IPC (RAG, agent, doc, help, new)
    // we implement them locally. Editor-mutating commands are forwarded to
    // the main window before we ever reach dispatchCommand.
    const terminalManager = {
      state: terminalState,
      appendTerminalOutput,
      clearTerminal,
      showTerminal: () => {},
      showAvailableCommands,
      updateContextBar,
      executeDocCommand,
      executeAgentCommand,
      indexFolderForRAG,
      reindexRAG,
      searchWithRAG,
      reindexWiki
    };

    if (parsed && EDITOR_COMMANDS.has(parsed.name)) {
      forwardEditorCommand(command);
      return;
    }

    // /wiki graph requires the main window's modal — forward there.
    if (parsed && parsed.name === '/wiki' && (parsed.args || '').trim().toLowerCase() === 'graph') {
      forwardEditorCommand(command);
      return;
    }

    if (parsed) {
      try {
        const handled = await dispatchCommand(parsed, terminalManager);
        if (handled) return;
      } catch (err) {
        appendTerminalOutput(`Error: ${err.message}`, 'error');
        terminalState.isClaudeRunning = false;
        terminalStop.classList.add('hidden');
        return;
      }
    }

    // Plain text or unrecognized slash command — route to agent mode for
    // parity with the main TerminalManager (tools + shared history).
    const cwd = terminalState.projectRoot || terminalState.currentDirectory;
    if (!cwd) {
      appendTerminalOutput('Error: No project folder open. Add or select a bucket from the Buckets menu first.', 'error');
      return;
    }

    await executeAgentCommand(command, cwd);
  }

  // --- Event handlers ---

  function setupEventHandlers() {
    // Load terminal state from main window
    window.addEventListener('vomit:load-terminal', (e) => {
      const data = e.detail;
      terminalState.basePath = data.basePath;
      terminalState.projectRoot = data.projectRoot;
      terminalState.currentDirectory = data.currentDirectory;
      terminalState.currentFilePath = data.currentFilePath;

      // Load terminal HTML directly (replaces banner if it was rendered first;
      // we re-prepend the banner so it always sits at the top).
      if (data.terminalHTML) {
        terminalOutput.innerHTML = data.terminalHTML;
      }
      showWelcomeBanner();
      terminalOutput.scrollTop = terminalOutput.scrollHeight;

      // Set theme
      if (data.currentTheme) {
        document.body.className = `theme-${data.currentTheme}`;
        if (xterm) {
          xterm.options.theme = getXtermTheme();
        }
      }
    });

    // Live context updates from the main window (tab switch, file open,
    // bucket change). Keeps slash-commands working against the current doc.
    window.addEventListener('vomit:terminal-context-update', (e) => {
      const data = e.detail || {};
      if ('basePath' in data) terminalState.basePath = data.basePath;
      if ('projectRoot' in data) terminalState.projectRoot = data.projectRoot;
      if ('currentDirectory' in data) terminalState.currentDirectory = data.currentDirectory;
      if ('currentFilePath' in data) terminalState.currentFilePath = data.currentFilePath;
    });

    // AI terminal output
    window.addEventListener('vomit:claude-output', (e) => {
      appendTerminalOutput(e.detail, 'output');
    });

    window.addEventListener('vomit:claude-error', (e) => {
      appendTerminalOutput(e.detail, 'error');
    });

    window.addEventListener('vomit:claude-done', (e) => {
      terminalState.isClaudeRunning = false;
      terminalStop.classList.add('hidden');
      markOutputComplete();
      if (e.detail === -1) {
        appendTerminalOutput('Stopped.', 'system');
      }
      // Context bar reflects history token usage; refresh after each turn.
      updateContextBar();
    });

    // RAG progress events fire while indexing — mirror main TerminalManager.
    window.addEventListener('vomit:rag-progress', (e) => {
      const progress = e.detail;
      if (!progress) return;
      if (progress.status === 'indexing') {
        appendTerminalOutput(`Indexing: ${progress.file} (${progress.current}/${progress.total})`, 'system');
      } else if (progress.status === 'done') {
        appendTerminalOutput(`✓ Indexed ${progress.total} files successfully!`, 'output');
      } else if (progress.status === 'error') {
        appendTerminalOutput(`✗ Error: ${progress.error}`, 'error');
      }
    });

    // Wiki indexing progress — quieter than RAG (no per-file noise).
    window.addEventListener('vomit:wiki-progress', (e) => {
      const progress = e.detail;
      if (!progress) return;
      if (progress.status === 'indexing' && progress.current === progress.total) {
        appendTerminalOutput(`Indexed ${progress.total} notes for wikilinks.`, 'system');
      }
    });

    // Context-stats events fire after each agent turn from the main process.
    window.addEventListener('vomit:context-stats-updated', () => {
      updateContextBar();
    });

    // Provider/model change — keep the title and context bar in sync.
    window.addEventListener('vomit:ai-provider-changed', () => {
      updateTerminalTitle();
      updateContextBar();
    });

    // Shell terminal output
    window.addEventListener('vomit:shell-output', (e) => {
      appendShellOutput(e.detail);
    });

    window.addEventListener('vomit:shell-exit', (e) => {
      terminalState.isShellRunning = false;
      if (e.detail === -1) {
        appendShellOutput('\r\n[Shell terminated]\r\n');
      }
    });

    // Terminal tab changed from main window
    window.addEventListener('vomit:terminal-tab-changed', (e) => {
      switchTerminalTab(e.detail);
    });

    // Theme changes
    window.addEventListener('vomit:set-theme', (e) => {
      document.body.className = `theme-${e.detail}`;
      if (xterm) {
        xterm.options.theme = getXtermTheme();
      }
    });

    // Tab switching
    terminalTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        switchTerminalTab(tab.dataset.terminal);
      });
    });

    // Terminal input - open picker when "/" is typed
    terminalInput.addEventListener('input', (e) => {
      const value = terminalInput.value;
      if (value.startsWith('/')) {
        openPicker(value);
      } else {
        closePicker();
      }
    });

    // Terminal input - keyboard shortcuts
    terminalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (pickerState.active && pickerState.items.length > 0) {
          const selected = pickerState.items[pickerState.selectedIndex];
          if (selected.args === 'none') {
            terminalInput.value = selected.name;
            closePicker();
          } else {
            terminalInput.value = selected.name + ' ';
            openPicker(terminalInput.value);
          }
        } else {
          const command = terminalInput.value.trim();
          if (command) {
            closePicker();
            executeClaudeCommand(command);
            terminalState.terminalHistory.push(command);
            terminalState.terminalHistoryIndex = terminalState.terminalHistory.length;
            persistHistory();
            terminalInput.value = '';
          }
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (pickerState.active && pickerState.items.length > 0) {
          const selected = pickerState.items[pickerState.selectedIndex];
          if (selected.args === 'none') {
            terminalInput.value = selected.name;
            closePicker();
          } else {
            terminalInput.value = selected.name + ' ';
            openPicker(terminalInput.value);
          }
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (pickerState.active) {
          pickerMoveSelection(-1);
        } else if (terminalState.terminalHistoryIndex > 0) {
          terminalState.terminalHistoryIndex--;
          terminalInput.value = terminalState.terminalHistory[terminalState.terminalHistoryIndex] || '';
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (pickerState.active) {
          pickerMoveSelection(1);
        } else if (terminalState.terminalHistoryIndex < terminalState.terminalHistory.length - 1) {
          terminalState.terminalHistoryIndex++;
          terminalInput.value = terminalState.terminalHistory[terminalState.terminalHistoryIndex] || '';
        } else {
          terminalState.terminalHistoryIndex = terminalState.terminalHistory.length;
          terminalInput.value = '';
        }
      } else if (e.key === 'Escape') {
        if (pickerState.active) {
          closePicker();
        }
      }
    });

    // Clear button
    terminalClear.addEventListener('click', async () => {
      if (terminalState.activeTerminalTab === 'ai') {
        clearTerminal();
        window.vomit.claudeClearHistory();
        await window.vomit.agentClearHistory();
        appendTerminalOutput('Conversation cleared.', 'system');
        updateContextBar();
        // Sync clear to main window
        window.vomit.syncTerminalClear();
      } else {
        clearShellTerminal();
      }
    });

    // Stop button
    terminalStop.addEventListener('click', () => {
      window.vomit.claudeStop();
    });

    // Reattach button
    terminalReattach.addEventListener('click', () => {
      window.vomit.reattachTerminal();
    });
  }

  function showWelcomeBanner() {
    if (terminalOutput.querySelector('.terminal-banner')) return;
    const banner = document.createElement('pre');
    banner.className = 'terminal-line terminal-banner';
    banner.textContent =
      '\n' +
      '  ██╗   ██╗ ██████╗ ███╗   ███╗██╗████████╗      ╭─────────╮\n' +
      '  ██║   ██║██╔═══██╗████╗ ████║██║╚══██╔══╝      │  ×   ×  │\n' +
      '  ██║   ██║██║   ██║██╔████╔██║██║   ██║         │         │\n' +
      '  ╚██╗ ██╔╝██║   ██║██║╚██╔╝██║██║   ██║         │  ─────  │\n' +
      '   ╚████╔╝ ╚██████╔╝██║ ╚═╝ ██║██║   ██║         ╰─────────╯\n' +
      '    ╚═══╝   ╚═════╝ ╚═╝     ╚═╝╚═╝   ╚═╝\n' +
      '\n' +
      '   keyboard-first markdown · type / for commands · ↩ to reattach\n';
    // Always prepend so a fresh banner sits above any transferred docked
    // content (load-terminal can fire before or after this).
    terminalOutput.insertBefore(banner, terminalOutput.firstChild);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }

  // Initialize
  configureMarked();
  setupEventHandlers();
  showWelcomeBanner();
  terminalInput.focus();

  // Seed history + UI state from the main process so up/down arrow works
  // immediately and the context bar appears if a conversation is already
  // in flight when the user detaches.
  (async () => {
    try {
      if (window.vomit && window.vomit.getTerminalHistory) {
        const history = await window.vomit.getTerminalHistory();
        if (Array.isArray(history)) {
          terminalState.terminalHistory = history.slice();
          terminalState.terminalHistoryIndex = terminalState.terminalHistory.length;
        }
      }
    } catch (e) {
      // History is informational; ignore failures.
    }
    updateTerminalTitle();
    updateContextBar();
    showWelcomeBanner();
  })();

})();

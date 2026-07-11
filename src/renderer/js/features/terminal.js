// TerminalManager — AI terminal, shell terminal, commands, and output formatting.

class TerminalManager {
  constructor({ state, host, dom, getTabManager, getPreviewManager, getFileTreeManager }) {
    this.state = state;
    this.host = host;

    // DOM refs
    this.terminalPanel = dom.terminalPanel;
    this.terminalResize = dom.terminalResize;
    this.terminalClear = dom.terminalClear;
    this.terminalStop = dom.terminalStop;
    this.terminalClose = dom.terminalClose;
    this.terminalDetach = dom.terminalDetach;
    this.terminalTabs = dom.terminalTabs;
    this.aiTerminalContent = dom.aiTerminalContent;
    this.terminalOutput = dom.terminalOutput;
    this.terminalInput = dom.terminalInput;
    this.terminalContextBar = dom.terminalContextBar;
    this.shellTerminalContent = dom.shellTerminalContent;
    this.shellTerminalContainer = dom.shellTerminalContainer;

    // Lazy getters for cross-module deps
    this._getTabManager = getTabManager;
    this._getPreviewManager = getPreviewManager;
    this._getFileTreeManager = getFileTreeManager;

    // xterm state
    this.xterm = null;
    this.xtermFitAddon = null;

    // pseudonymization output path
    this.pseudoOutputPath = null;

    // Session-scoped real→fake mapping accumulated by /pseudo-text and
    // /pseudo-text-ai, so /pseudo-depseudo-text can reverse pasted text. In memory
    // only — cleared on restart.
    this.pseudoTextMap = {};

    // Inline command picker state
    this.pickerState = { active: false, items: [], selectedIndex: 0, blockEl: null };

    // Write mode state (for streaming to editor)
    this.writeMode = null; // null, 'cursor', 'new', 'replace', 'append'
    this.writeBuffer = '';
    this.writeNewPath = null; // disk path for /write-new, so we can persist on finish

    // When set, the next terminal Enter is captured as a free-text answer
    // (e.g. the filename prompt for /write-new) instead of a command.
    this._pendingInputResolver = null;
    // Id of the agent permission prompt this window is currently showing.
    this._activePermissionId = null;
  }

  get tabManager() { return this._getTabManager(); }
  get previewManager() { return this._getPreviewManager(); }
  get fileTreeManager() { return this._getFileTreeManager(); }

  // --- IPC event handlers ---

  setupIPC() {
    window.addEventListener('vomit:toggle-terminal', () => {
      this.toggleTerminal();
    });

    window.addEventListener('vomit:show-terminal', () => {
      this.showTerminal();
    });

    window.addEventListener('vomit:claude-output', (e) => {
      const output = this.normalizeTerminalText(e.detail);
      const cleanOutput = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

      if (this.state.pseudoCollecting) {
        this.state.pseudoOutput += cleanOutput;
      } else if (this.writeMode) {
        // In write mode, stream to editor AND show in terminal
        this.writeBuffer += cleanOutput;
        this.streamToEditor(cleanOutput);
        this.appendTerminalOutput(output, 'output');
      } else {
        this.appendTerminalOutput(output, 'output');
      }
    });

    window.addEventListener('vomit:claude-error', (e) => {
      this.appendTerminalOutput(this.normalizeTerminalText(e.detail), 'error');
    });

    window.addEventListener('vomit:claude-done', (e) => {
      this.state.isClaudeRunning = false;
      this.terminalStop.classList.add('hidden');

      if (this.writeMode) {
        this.finalizeWriteMode(e.detail === -1);
      } else {
        this.markOutputComplete();
        if (e.detail === -1) {
          this.appendTerminalOutput('Stopped.', 'system');
        }
      }
    });

    window.addEventListener('vomit:claude-metrics', (e) => {
      const line = this._formatMetrics(e.detail);
      if (line) this.appendTerminalOutput(line, 'system');
    });

    // Pre-flight notices (truncation, attached images, retries) — shown as
    // system lines but the thinking indicator stays alive below them.
    window.addEventListener('vomit:claude-status', (e) => {
      this.appendTerminalOutput(this.normalizeTerminalText(e.detail), 'system');
      const indicator = this.terminalOutput.querySelector('.terminal-thinking-indicator');
      if (indicator) {
        this.terminalOutput.appendChild(indicator);
        this.terminalOutput.scrollTop = this.terminalOutput.scrollHeight;
      }
    });

    window.addEventListener('vomit:agent-permission-request', (e) => {
      this._onPermissionRequest(e.detail || {});
    });

    window.addEventListener('vomit:agent-permission-resolved', (e) => {
      this._onPermissionResolved(e.detail || {});
    });

    window.addEventListener('vomit:toggle-shell-terminal', () => {
      this.toggleShellTerminal();
    });

    window.addEventListener('vomit:shell-output', (e) => {
      this.appendShellOutput(e.detail);
    });

    window.addEventListener('vomit:shell-exit', (e) => {
      this.state.isShellRunning = false;
      if (e.detail === -1) {
        this.appendShellOutput('\r\n[Shell terminated]\r\n');
      }
    });

    window.addEventListener('vomit:ai-provider-changed', (e) => {
      this.updateTerminalTitle(e.detail);
      this.updateContextBar();
    });

    window.addEventListener('vomit:context-stats-updated', () => {
      this.updateContextBar();
    });

    window.addEventListener('vomit:rag-progress', (e) => {
      const progress = e.detail;
      if (progress.status === 'indexing') {
        this.appendTerminalOutput(`Indexing: ${progress.file} (${progress.current}/${progress.total})`, 'system');
      } else if (progress.status === 'done') {
        this.appendTerminalOutput(`✓ Indexed ${progress.total} files successfully!`, 'output');
      } else if (progress.status === 'error') {
        this.appendTerminalOutput(`✗ Error: ${progress.error}`, 'error');
      }
    });

    window.addEventListener('vomit:wiki-progress', (e) => {
      const progress = e.detail;
      if (progress.status === 'indexing' && progress.current === progress.total) {
        this.appendTerminalOutput(`Indexed ${progress.total} notes for wikilinks.`, 'system');
      }
    });

    window.addEventListener('vomit:terminal-detached', () => {
      this.onTerminalDetached();
    });

    window.addEventListener('vomit:terminal-reattached', () => {
      this.onTerminalReattached();
    });

    window.addEventListener('vomit:terminal-input-synced', (e) => {
      // Display user input from detached terminal in main terminal
      const input = e.detail;
      this.appendTerminalOutput(`> ${input}`, 'input');
    });

    window.addEventListener('vomit:terminal-cleared', () => {
      // Clear main terminal when detached terminal is cleared
      this.clearTerminal();
      this.appendTerminalOutput('Conversation cleared.', 'system');
      this.updateContextBar();
    });

    // Commands that need CodeMirror access (the editor) are forwarded from
    // the detached terminal window to here, so the main TerminalManager runs
    // them with full host access. Output streams back to both windows via
    // syncTerminalOutput, so the user sees the response wherever they typed.
    window.addEventListener('vomit:execute-detached-command', (e) => {
      const command = e.detail;
      if (!command) return;
      this.appendTerminalOutput(`> ${command}`, 'input');
      this.executeClaudeCommand(command);
    });
  }

  // --- Terminal setup and UI ---

  setupTerminal() {
    if (!this.terminalInput) return;

    this.showWelcomeBanner();

    // Load persisted command history
    window.vomit.getTerminalHistory().then(history => {
      this.state.terminalHistory = history;
      this.state.terminalHistoryIndex = history.length;
    });

    // Handle input changes - show inline picker when typing /
    this.terminalInput.addEventListener('input', () => {
      const value = this.terminalInput.value;
      if (value.startsWith('/')) {
        this._openPicker(value);
      } else {
        this._closePicker();
      }
    });

    // Handle input submission
    this.terminalInput.addEventListener('keydown', async (e) => {
      // Agent permission prompts accept single-keypress answers when the
      // input is empty (a/r/s for diff prompts, y/n/a for plain ones).
      if (this._activePermissionId && this._pendingInputResolver && this.terminalInput.value === '' &&
          !e.metaKey && !e.ctrlKey && !e.altKey &&
          ['a', 'r', 's', 'y', 'n'].includes((e.key || '').toLowerCase())) {
        e.preventDefault();
        const key = e.key.toLowerCase();
        this.appendTerminalOutput(`❯ ${key}`, 'input');
        const resolve = this._pendingInputResolver;
        this._pendingInputResolver = null;
        resolve(key);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        // A prompt is awaiting a free-text answer — capture this line as the answer.
        if (this._pendingInputResolver) {
          this._closePicker();
          const answer = this.terminalInput.value.trim();
          this.terminalInput.value = '';
          this.appendTerminalOutput(`❯ ${answer}`, 'input');
          const resolve = this._pendingInputResolver;
          this._pendingInputResolver = null;
          resolve(answer);
          return;
        }
        if (this.pickerState.active && this.pickerState.items.length > 0) {
          // Picker is open: complete the selection (Tab and Enter are equivalent)
          const selected = this.pickerState.items[this.pickerState.selectedIndex];
          if (selected.args === 'required') {
            // Must provide args — complete to name + space and keep picker open
            this.terminalInput.value = selected.name + ' ';
            this._openPicker(this.terminalInput.value);
          } else {
            // args: 'none' or 'optional' — execute immediately
            this._closePicker();
            this.executeClaudeCommand(selected.name);
            this.state.terminalHistory.push(selected.name);
            this.state.terminalHistoryIndex = this.state.terminalHistory.length;
            window.vomit.setTerminalHistory(this.state.terminalHistory);
            this.terminalInput.value = '';
          }
        } else {
          this._closePicker();
          const command = this.terminalInput.value.trim();
          if (command) {
            this.executeClaudeCommand(command);
            this.state.terminalHistory.push(command);
            this.state.terminalHistoryIndex = this.state.terminalHistory.length;
            window.vomit.setTerminalHistory(this.state.terminalHistory);
            this.terminalInput.value = '';
          }
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (this.pickerState.active && this.pickerState.items.length > 0) {
          const selected = this.pickerState.items[this.pickerState.selectedIndex];
          if (selected.args === 'none') {
            this.terminalInput.value = selected.name;
            this._closePicker();
          } else {
            this.terminalInput.value = selected.name + ' ';
            this._openPicker(this.terminalInput.value);
          }
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.pickerState.active) {
          this._pickerMoveSelection(-1);
        } else if (this.state.terminalHistoryIndex > 0) {
          this.state.terminalHistoryIndex--;
          this.terminalInput.value = this.state.terminalHistory[this.state.terminalHistoryIndex] || '';
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.pickerState.active) {
          this._pickerMoveSelection(1);
        } else if (this.state.terminalHistoryIndex < this.state.terminalHistory.length - 1) {
          this.state.terminalHistoryIndex++;
          this.terminalInput.value = this.state.terminalHistory[this.state.terminalHistoryIndex] || '';
        } else {
          this.state.terminalHistoryIndex = this.state.terminalHistory.length;
          this.terminalInput.value = '';
        }
      } else if (e.key === 'c' && e.ctrlKey) {
        // Ctrl+C to stop running process
        e.preventDefault();
        if (this.state.isClaudeRunning) {
          this.stopAI();
        }
      } else if (e.key === 'Escape') {
        if (this._pendingInputResolver) {
          e.preventDefault();
          this.terminalInput.value = '';
          const resolve = this._pendingInputResolver;
          this._pendingInputResolver = null;
          resolve(''); // empty answer = cancel
        } else if (this.pickerState.active) {
          this._closePicker();
        } else if (this.state.isClaudeRunning) {
          this.stopAI();
        } else {
          // Close the terminal panel
          this.state.isTerminalPanelVisible = false;
          this.terminalPanel.classList.add('hidden');
          // Clear inline padding style
          const mainContainer = document.getElementById('main-container');
          if (mainContainer) mainContainer.style.paddingBottom = '';
          this.host.focus();
        }
      } else if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.clearTerminal();
        window.vomit.claudeClearHistory();
        await window.vomit.agentClearHistory();
        this.state.terminalHistory = [];
        this.state.terminalHistoryIndex = 0;
        window.vomit.clearTerminalHistory();
        this.appendTerminalOutput('Conversation and command history cleared.', 'system');
        this.updateContextBar();
      }
    });

    // Clear button - clears active terminal
    this.terminalClear.addEventListener('click', async () => {
      if (this.state.activeTerminalTab === 'ai') {
        this.clearTerminal();
        window.vomit.claudeClearHistory();
        await window.vomit.agentClearHistory();
        this.appendTerminalOutput('Conversation cleared.', 'system');
        this.updateContextBar();
      } else {
        this.clearShellTerminal();
      }
    });

    // Stop button
    this.terminalStop.addEventListener('click', () => {
      window.vomit.claudeStop();
    });

    // Close button - closes the entire terminal panel
    this.terminalClose.addEventListener('click', () => {
      this.state.isTerminalPanelVisible = false;
      this.terminalPanel.classList.add('hidden');
      // Clear inline padding style
      const mainContainer = document.getElementById('main-container');
      if (mainContainer) mainContainer.style.paddingBottom = '';
      this.host.focus();
    });

    // Detach/Reattach button - toggle between detached and attached states
    this.terminalDetach.addEventListener('click', () => {
      if (this.state.isTerminalDetached) {
        window.vomit.reattachTerminal();
      } else {
        this.detachTerminal();
      }
    });

    // Terminal resize
    this.setupTerminalResize();

    // Initialize terminal title based on AI provider
    this.initTerminalTitle();

    // Setup terminal tab switching
    this.terminalTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.terminal;
        this.switchTerminalTab(targetTab);
      });
    });

    // Open RAG source documents in the editor when their links are clicked
    this.terminalOutput.addEventListener('click', (e) => {
      const link = e.target.closest('.terminal-doc-link');
      if (!link) return;
      e.preventDefault();
      if (link.dataset.file) window.vomit.openFile(link.dataset.file);
    });

    // Global Ctrl+C handler for terminal
    this.terminalPanel.addEventListener('keydown', (e) => {
      if (e.key === 'c' && e.ctrlKey && this.state.isClaudeRunning) {
        e.preventDefault();
        this.stopAI();
      }
    });

    // Also listen on document level when terminal is visible
    document.addEventListener('keydown', (e) => {
      if (e.key === 'c' && e.ctrlKey && this.state.isTerminalPanelVisible && this.state.isClaudeRunning) {
        e.preventDefault();
        this.stopAI();
      }
    });
  }

  showAvailableCommands() {
    const { COMMAND_REGISTRY } = window.TerminalCommands;
    this.appendTerminalOutput('Available commands:', 'system');
    COMMAND_REGISTRY.forEach(c => {
      const args = c.argsHint ? ` ${c.argsHint}` : '';
      this.appendTerminalOutput(`  ${c.name}${args}  —  ${c.description}`, 'system');
    });
    this.appendTerminalOutput('', 'system');
  }

  showWelcomeBanner() {
    if (this.terminalOutput.querySelector('.terminal-banner')) return;
    const banner = document.createElement('pre');
    banner.className = 'terminal-line terminal-banner';
    const mod = navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl';
    banner.textContent =
      '\n' +
      '  ██╗   ██╗ ██████╗ ███╗   ███╗██╗████████╗      ╭─────────╮\n' +
      '  ██║   ██║██╔═══██╗████╗ ████║██║╚══██╔══╝      │  ×   ×  │\n' +
      '  ██║   ██║██║   ██║██╔████╔██║██║   ██║         │         │\n' +
      '  ╚██╗ ██╔╝██║   ██║██║╚██╔╝██║██║   ██║         │  ─────  │\n' +
      '   ╚████╔╝ ╚██████╔╝██║ ╚═╝ ██║██║   ██║         ╰─────────╯\n' +
      '    ╚═══╝   ╚═════╝ ╚═╝     ╚═╝╚═╝   ╚═╝\n' +
      '\n' +
      `   keyboard-first markdown · type / for commands · ${mod}+J to toggle\n`;
    this.terminalOutput.insertBefore(banner, this.terminalOutput.firstChild);
  }

  _openPicker(inputValue) {
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
        this._closePicker();
        return;
      }
    } else {
      filtered = [...COMMAND_REGISTRY]
        .filter(c => c.name.toLowerCase().startsWith(lower))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    if (filtered.length === 0) {
      this._closePicker();
      return;
    }

    this.pickerState.selectedIndex = 0;
    this.pickerState.items = filtered;
    this.pickerState.active = true;
    this._renderPicker();
  }

  _closePicker() {
    if (this.pickerState.blockEl) {
      this.pickerState.blockEl.remove();
      this.pickerState.blockEl = null;
    }
    this.pickerState.active = false;
    this.pickerState.items = [];
    this.pickerState.selectedIndex = 0;
  }

  _renderPicker() {
    const { items, selectedIndex } = this.pickerState;
    const maxLen = Math.max(...items.map(c => c.name.length));
    const maxHintLen = Math.max(0, ...items.map(c => (c.argsHint || '').length));
    const showArgs = maxHintLen > 0;

    if (!this.pickerState.blockEl) {
      const el = document.createElement('div');
      el.className = 'terminal-picker-block';
      this.terminalOutput.appendChild(el);
      this.pickerState.blockEl = el;
    }

    this.pickerState.blockEl.innerHTML = items.map((c, i) => {
      const isSelected = i === selectedIndex;
      const marker = isSelected ? '▸' : ' ';
      const name = c.name.padEnd(maxLen);
      const argsStr = showArgs ? `  ${(c.argsHint || '').padEnd(maxHintLen)}` : '';
      const cls = isSelected ? 'terminal-line system terminal-picker-selected' : 'terminal-line system';
      const text = ` ${marker} ${name}${argsStr}  —  ${c.description}`;
      return `<div class="${cls}" style="white-space:pre">${this.escapeHtml(text)}</div>`;
    }).join('');

    // Scroll the selected row into view rather than always jumping to bottom
    const selectedEl = this.pickerState.blockEl.querySelector('.terminal-picker-selected');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  _pickerMoveSelection(delta) {
    const n = this.pickerState.items.length;
    this.pickerState.selectedIndex = (this.pickerState.selectedIndex + delta + n) % n;
    this._renderPicker();
  }

  switchTerminalTab(tabName) {
    this.state.activeTerminalTab = tabName;

    // Update tab buttons
    this.terminalTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.terminal === tabName);
    });

    // Update content visibility
    this.aiTerminalContent.classList.toggle('active', tabName === 'ai');
    this.shellTerminalContent.classList.toggle('active', tabName === 'shell');

    // Focus appropriate element and initialize shell if needed
    if (tabName === 'ai') {
      this.terminalInput.focus();
    } else if (tabName === 'shell') {
      this.initXterm();
      if (!this.state.isShellRunning) {
        this.startShell();
      }
      setTimeout(() => {
        if (this.xtermFitAddon) {
          this.xtermFitAddon.fit();
        }
        if (this.xterm) {
          this.xterm.focus();
        }
      }, 0);
    }
  }

  async startShell() {
    const cwd = this.state.projectRoot || this.state.currentDirectory;
    await window.vomit.shellSpawn(cwd);
    this.state.isShellRunning = true;
    setTimeout(() => {
      if (this.xterm) {
        window.vomit.shellResize(this.xterm.cols, this.xterm.rows);
      }
    }, 100);
  }

  setupTerminalResize() {
    if (!this.terminalResize) return;

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;
    const mainContainer = document.getElementById('main-container');

    this.terminalResize.addEventListener('mousedown', (e) => {
      isResizing = true;
      startY = e.clientY;
      startHeight = this.terminalPanel.offsetHeight;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const delta = startY - e.clientY;
      const maxHeight = window.innerHeight - 24; // leave room for status bar
      const newHeight = Math.max(100, Math.min(maxHeight, startHeight + delta));
      this.terminalPanel.style.height = `${newHeight}px`;
      // Update main container padding to match terminal height
      if (mainContainer) {
        mainContainer.style.paddingBottom = `${newHeight}px`;
      }
      // Fit xterm when resizing
      if (this.state.activeTerminalTab === 'shell' && this.xtermFitAddon) {
        this.xtermFitAddon.fit();
      }
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Final fit and notify shell of resize
        if (this.state.activeTerminalTab === 'shell' && this.xtermFitAddon) {
          this.xtermFitAddon.fit();
          if (this.state.isShellRunning && this.xterm) {
            window.vomit.shellResize(this.xterm.cols, this.xterm.rows);
          }
        }
      }
    });
  }

  toggleTerminal() {
    // If terminal is detached, focus the terminal window instead of toggling
    if (this.state.isTerminalDetached) {
      window.vomit.focusTerminalWindow();
      return;
    }

    const mainContainer = document.getElementById('main-container');
    if (this.state.isTerminalPanelVisible && this.state.activeTerminalTab === 'ai') {
      // Already showing AI terminal, close the panel
      this.state.isTerminalPanelVisible = false;
      this.terminalPanel.classList.add('hidden');
      // Clear inline padding style (CSS will handle the rest)
      if (mainContainer) mainContainer.style.paddingBottom = '';
      this.host.focus();
    } else {
      // Show panel and switch to AI tab
      this.state.isTerminalPanelVisible = true;
      this.terminalPanel.classList.remove('hidden');
      // Set padding to match current terminal height
      if (mainContainer) {
        mainContainer.style.paddingBottom = `${this.terminalPanel.offsetHeight}px`;
      }
      this.switchTerminalTab('ai');
    }
  }

  showTerminal() {
    if (!this.state.isTerminalPanelVisible || this.state.activeTerminalTab !== 'ai') {
      this.state.isTerminalPanelVisible = true;
      this.terminalPanel.classList.remove('hidden');
      // Set padding to match current terminal height
      const mainContainer = document.getElementById('main-container');
      if (mainContainer) {
        mainContainer.style.paddingBottom = `${this.terminalPanel.offsetHeight}px`;
      }
      this.switchTerminalTab('ai');
    }
  }

  // --- Shell terminal methods (using xterm.js) ---

  setupShellTerminal() {
    if (!this.shellTerminalContainer) return;
    // Shell terminal is now part of unified panel - no separate setup needed
  }

  getXtermTheme() {
    const styles = getComputedStyle(document.body);
    const bgPrimary = styles.getPropertyValue('--bg-primary').trim() || '#1e1e1e';
    const bgSecondary = styles.getPropertyValue('--bg-secondary').trim() || '#252526';
    const textPrimary = styles.getPropertyValue('--text-primary').trim() || '#d4d4d4';
    const textMuted = styles.getPropertyValue('--text-muted').trim() || '#6e6e6e';
    const accentColor = styles.getPropertyValue('--accent-color').trim() || '#569cd6';

    // Detect if it's a light theme based on background luminance
    const isLight = this.isLightColor(bgPrimary);

    if (isLight) {
      // Light theme colors
      return {
        background: bgPrimary,
        foreground: textPrimary,
        cursor: textPrimary,
        cursorAccent: bgPrimary,
        selectionBackground: 'rgba(0, 0, 0, 0.15)',
        selectionForeground: textPrimary,
        black: '#000000',
        red: '#c91b00',
        green: '#00c200',
        yellow: '#c7c400',
        blue: '#0225c7',
        magenta: '#c930c7',
        cyan: '#00c5c7',
        white: '#c7c7c7',
        brightBlack: '#676767',
        brightRed: '#ff6d67',
        brightGreen: '#5ff967',
        brightYellow: '#fefb67',
        brightBlue: '#6871ff',
        brightMagenta: '#ff76ff',
        brightCyan: '#5ffdff',
        brightWhite: '#fffefe'
      };
    } else {
      // Dark theme colors - derive from CSS variables where possible
      return {
        background: bgPrimary,
        foreground: textPrimary,
        cursor: accentColor,
        cursorAccent: bgPrimary,
        selectionBackground: 'rgba(255, 255, 255, 0.2)',
        selectionForeground: textPrimary,
        black: bgSecondary,
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: textPrimary,
        brightBlack: textMuted,
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#94e2d5',
        brightWhite: '#ffffff'
      };
    }
  }

  isLightColor(color) {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
  }

  updateXtermTheme() {
    if (this.xterm) {
      this.xterm.options.theme = this.getXtermTheme();
    }
  }

  initXterm() {
    if (this.xterm) return; // Already initialized

    // Create xterm.js instance with theme from CSS variables
    this.xterm = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: "'MesloLGS NF', 'Hack Nerd Font', 'FiraCode Nerd Font', 'JetBrainsMono Nerd Font', 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace",
      theme: this.getXtermTheme(),
      allowProposedApi: true,
      scrollback: 10000
    });

    // Create and load fit addon
    this.xtermFitAddon = new FitAddon.FitAddon();
    this.xterm.loadAddon(this.xtermFitAddon);

    // Open terminal in container
    this.xterm.open(this.shellTerminalContainer);

    // Fit to container
    setTimeout(() => {
      this.xtermFitAddon.fit();
      // Send resize to PTY
      if (this.state.isShellRunning) {
        window.vomit.shellResize(this.xterm.cols, this.xterm.rows);
      }
    }, 0);

    // Handle user input - send to PTY
    this.xterm.onData((data) => {
      if (this.state.isShellRunning) {
        window.vomit.shellWrite(data);
      }
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      if (this.state.isTerminalPanelVisible && this.state.activeTerminalTab === 'shell' && this.xtermFitAddon) {
        this.xtermFitAddon.fit();
        if (this.state.isShellRunning) {
          window.vomit.shellResize(this.xterm.cols, this.xterm.rows);
        }
      }
    });
  }

  toggleShellTerminal() {
    const mainContainer = document.getElementById('main-container');
    if (this.state.isTerminalPanelVisible && this.state.activeTerminalTab === 'shell') {
      // Already showing shell terminal, close the panel
      this.state.isTerminalPanelVisible = false;
      this.terminalPanel.classList.add('hidden');
      // Clear inline padding style
      if (mainContainer) mainContainer.style.paddingBottom = '';
      this.host.focus();
    } else {
      // Show panel and switch to shell tab
      this.state.isTerminalPanelVisible = true;
      this.terminalPanel.classList.remove('hidden');
      // Set padding to match current terminal height
      if (mainContainer) {
        mainContainer.style.paddingBottom = `${this.terminalPanel.offsetHeight}px`;
      }
      this.switchTerminalTab('shell');
    }
  }

  appendShellOutput(data) {
    if (this.xterm) {
      this.xterm.write(data);
    }
  }

  clearShellTerminal() {
    if (this.xterm) {
      this.xterm.clear();
    }
  }

  // --- AI commands ---

  async executeClaudeCommand(command) {
    const { parseCommand, dispatchCommand } = window.TerminalCommands;
    const parsed = parseCommand(command);
    if (parsed) {
      try {
        const handled = await dispatchCommand(parsed, this);
        if (handled) return;
      } catch (err) {
        this.appendTerminalOutput(`Error: ${err.message}`, 'error');
        this.state.isClaudeRunning = false;
        this.terminalStop.classList.add('hidden');
        return;
      }
    }

    // Plain text or unrecognized slash command — route to agent mode (has tools + history)
    const cwd = this.state.projectRoot || this.state.currentDirectory;
    if (!cwd) {
      this.appendTerminalOutput('Error: No project folder open. Add or select a bucket from the Buckets menu first.', 'error');
      return;
    }

    await this.executeAgentCommand(command, cwd);
  }

  async executeDocCommand(prompt, cwd) {
    const docContent = this.host.getContent();
    const finalCommand = `Here is the document I'm working on:\n\n---\n${docContent}\n---\n\nUser request: ${prompt}`;
    this.appendTerminalOutput(`❯ ${prompt} (with document context)`, 'input');
    this.state.isClaudeRunning = true;
    this.terminalStop.classList.remove('hidden');
    this.showThinkingIndicator();

    try {
      await window.vomit.agentExecute(finalCommand, cwd);
    } catch (err) {
      this.hideThinkingIndicator();
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
      this.state.isClaudeRunning = false;
      this.terminalStop.classList.add('hidden');
    }
  }

  async executeAgentCommand(prompt, cwd) {
    this.appendTerminalOutput(`❯ /agent ${prompt}`, 'input');
    this.appendTerminalOutput('Running in agent mode with tools...', 'system');

    this.state.isClaudeRunning = true;
    this.terminalStop.classList.remove('hidden');
    this.showThinkingIndicator();

    try {
      await window.vomit.agentExecute(prompt, cwd);
    } catch (err) {
      this.hideThinkingIndicator();
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
      this.state.isClaudeRunning = false;
      this.terminalStop.classList.add('hidden');
    }
  }

  // /chat — same conversation history as agent mode, but no tool schemas in
  // the request, so prompt eval (time to first token) is much faster.
  async executeChatCommand(prompt, cwd) {
    this.appendTerminalOutput(`❯ /chat ${prompt}`, 'input');

    this.state.isClaudeRunning = true;
    this.terminalStop.classList.remove('hidden');
    this.showThinkingIndicator();

    try {
      await window.vomit.agentExecute(prompt, cwd, { noTools: true });
    } catch (err) {
      this.hideThinkingIndicator();
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
      this.state.isClaudeRunning = false;
      this.terminalStop.classList.add('hidden');
    }
  }

  async generatePresentation(topic, cwd) {
    this.appendTerminalOutput(`❯ /presentation ${topic}`, 'input');
    this.appendTerminalOutput('Generating presentation...', 'system');

    const presentationPrompt = `Create a presentation about: ${topic}

FORMAT RULES (follow exactly):
- Separate slides with --- on its own line
- Add speaker notes after ??? on its own line (optional per slide)
- Use markdown formatting (# for titles, ## for subtitles, - for bullets)
- Keep slides concise (3-5 bullet points max per slide)
- Include a title slide, content slides, and a closing slide
- Output ONLY the presentation markdown, no explanations

EXAMPLE FORMAT:
# Presentation Title
Subtitle or tagline

---

## First Topic

- Key point one
- Key point two
- Key point three

???
These are speaker notes that only the presenter sees.
Explain the key points in more detail here.

---

## Second Topic

- Another point
- More content

---

## Conclusion

- Summary point
- Call to action

???
Wrap up and thank the audience.

---

Now create the presentation about: ${topic}`;

    this.state.isClaudeRunning = true;
    this.terminalStop.classList.remove('hidden');
    this.showThinkingIndicator();

    // Collect the AI output
    this.state.pseudoOutput = '';
    this.state.pseudoCollecting = true;

    try {
      await window.vomit.claudeExecute(presentationPrompt, cwd);
      await this.waitForAIComplete();

      if (this.state.pseudoOutput.trim()) {
        const presentation = this.state.pseudoOutput.trim();

        // Insert into editor, replacing current content or at cursor
        const currentContent = this.host.getContent();
        if (currentContent.trim() === '') {
          // Empty document - replace with presentation
          this.host.setContent(presentation);
          this.appendTerminalOutput('✓ Presentation inserted into editor', 'output');
        } else {
          // Has content - insert at cursor
          this.host.replaceSelection(presentation);
          this.appendTerminalOutput('✓ Presentation inserted at cursor', 'output');
        }
      }
      this.markOutputComplete();
    } catch (err) {
      this.hideThinkingIndicator();
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
      this.state.isClaudeRunning = false;
      this.terminalStop.classList.add('hidden');
    }
  }

  // --- Write commands (stream AI output to editor) ---

  // Ask the user a free-text question in the AI terminal and resolve with their
  // next Enter-submitted line ('' if they cancel with Escape or submit empty).
  askTerminalInput(question) {
    this.appendTerminalOutput(question, 'system');
    this.terminalInput.focus();
    return new Promise((resolve) => {
      this._pendingInputResolver = resolve;
    });
  }

  // --- Agent permission prompts ---

  // The main process asks whether an agent tool call may run. Show a y/n/a
  // prompt using the free-text input machinery; the answer goes back over IPC.
  // When the terminal is detached, the detached window owns the prompt — the
  // main window must not arm _pendingInputResolver or the user's next Enter
  // in the editor-side terminal would be swallowed as an answer.
  async _onPermissionRequest({ id, toolName, summary, kind, diff }) {
    if (!id) return;
    if (this.state.isTerminalDetached) return;
    if (this._pendingInputResolver) {
      // Another prompt (e.g. /write-new filename) is already waiting — deny
      // rather than clobbering its resolver.
      window.vomit.agentPermissionResponse(id, 'n');
      return;
    }
    this._activePermissionId = id;

    let question;
    if (kind === 'diff' && diff) {
      this.appendTerminalOutput(`⚠ ${toolName}: ${diff.header}`, 'system');
      this._renderDiffBlock(diff.text);
      question = '[a]pprove / [r]eject / [s] = always this session';
    } else {
      question = `⚠ Allow ${toolName}? ${summary}\n[y = yes / n = no / a = always this session]`;
    }

    const answer = await this.askTerminalInput(question);
    if (this._activePermissionId !== id) return; // resolved elsewhere
    this._activePermissionId = null;
    window.vomit.agentPermissionResponse(id, (answer || '').trim().toLowerCase());
  }

  // Render a unified diff with per-line +/- coloring. Uses dedicated diff-*
  // classes (not 'output') so lines don't merge into the AI stream element.
  _renderDiffBlock(text) {
    for (const line of String(text || '').split('\n')) {
      let cls = 'diff-ctx';
      if (line.startsWith('@@')) cls = 'diff-hunk';
      else if (line.startsWith('+')) cls = 'diff-add';
      else if (line.startsWith('-')) cls = 'diff-del';
      this.appendTerminalOutput(line, cls);
    }
  }

  // Another window answered (or the prompt timed out / was aborted) — clear
  // our pending prompt so the next Enter is a normal command again.
  _onPermissionResolved({ id }) {
    if (!id || this._activePermissionId !== id) return;
    this._activePermissionId = null;
    if (this._pendingInputResolver) {
      this._pendingInputResolver = null;
      this.appendTerminalOutput('(permission prompt answered elsewhere)', 'system');
    }
  }

  // Turn a user-typed document name into a unique .md path inside baseDir,
  // never clobbering an existing file (adds -1, -2, … if needed).
  async resolveNewDocPath(baseDir, name) {
    let fname = name.replace(/[\\/:*?"<>|]/g, '').trim();
    if (!fname) return null;
    if (!/\.md$/i.test(fname)) fname += '.md';

    const stem = fname.replace(/\.md$/i, '');
    let candidate = window.PathUtils.join(baseDir, fname);
    let n = 1;
    while (await this._pathExists(candidate)) {
      candidate = window.PathUtils.join(baseDir, `${stem}-${n}.md`);
      n++;
    }
    return candidate;
  }

  async _pathExists(filePath) {
    try {
      await window.vomit.readFile(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Metadata frontmatter for a new doc — mirrors the file-tree "new file"
  // template so /write-new docs are consistent with manually-created ones.
  _buildFrontmatter(filePath, baseDir) {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const title = window.PathUtils.basename(filePath)
      .replace(/\.(md|markdown)$/i, '')
      .replace(/[-_]/g, ' ');
    const folder = window.PathUtils.basename(baseDir);
    return `---\ntype: Note\ntitle: ${title}\nfolder: ${folder}\ncreated: ${today}\nmodified: ${today}\ndraft: true\ntags: []\n---\n\n`;
  }

  async executeWriteCommand(prompt, mode, cwd) {
    const modeLabels = {
      cursor: 'insert at cursor',
      new: 'create new file',
      replace: 'replace selection',
      append: 'append to document'
    };

    const cmdName = mode === 'new' ? '/write-new' :
                    mode === 'replace' ? '/write-replace' :
                    mode === 'append' ? '/write-append' : '/write';

    this.appendTerminalOutput(`❯ ${cmdName} ${prompt}`, 'input');
    this.appendTerminalOutput(`Writing to editor (${modeLabels[mode]})...`, 'system');

    // For replace mode, check if there's a selection
    let selectedText = '';
    if (mode === 'replace') {
      selectedText = this.host.getSelection();
      if (!selectedText) {
        this.appendTerminalOutput('Error: No text selected. Select text first.', 'error');
        return;
      }
    }

    // Set up write mode
    this.writeMode = mode;
    this.writeBuffer = '';
    this.writeStartCursor = null;
    this.writeNewPath = null;

    // For /write-new, ask for a name up front, create the file on disk, and open
    // it as a saved tab — so the doc exists before streaming and auto-save
    // covers the whole write. (window.vomit.newFile() only opens an inline
    // filename input in the file tree, which left the output in the old doc and
    // the new doc empty.)
    if (mode === 'new') {
      const bucketRoot = this.state.projectRoot || this.state.currentDirectory;
      const baseDir = this.state.currentFilePath
        ? window.PathUtils.dirname(this.state.currentFilePath)
        : bucketRoot;

      if (baseDir && this.tabManager) {
        const name = await this.askTerminalInput('Name for the new document:');
        if (!name) {
          this.appendTerminalOutput('Cancelled.', 'system');
          this.writeMode = null;
          return;
        }
        const newPath = await this.resolveNewDocPath(baseDir, name);
        if (!newPath) {
          this.appendTerminalOutput('Cancelled: invalid name.', 'system');
          this.writeMode = null;
          return;
        }
        const frontmatter = this._buildFrontmatter(newPath, baseDir);
        try {
          await window.vomit.writeFile(newPath, frontmatter);
        } catch (err) {
          this.appendTerminalOutput(`Error creating file: ${err.message || err}`, 'error');
          this.writeMode = null;
          return;
        }
        this.writeNewPath = newPath;
        this.tabManager.createTab(newPath, frontmatter);
        this.writeTabId = this.tabManager.activeTabId;
        this.appendTerminalOutput(`Created ${window.PathUtils.basename(newPath)}`, 'system');
        // Surface the new file in the tree.
        if (this.fileTreeManager && this.fileTreeManager.refreshFolder) {
          this.fileTreeManager.refreshFolder(baseDir);
        }
        // /write-new always researches the web for current info, then inserts
        // the final document body. (Plain model writes can't search and produce
        // stale content.) This path is self-contained — return when done.
        await this._runWebWriteNew(prompt, cwd, newPath);
        return;
      } else if (this.tabManager) {
        // No bucket/folder context — fall back to an unsaved tab.
        this.tabManager.createTab(null, '');
      } else {
        window.vomit.newFile();
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // /write-append also researches the web (so additions start from current
    // info), aware of what's already in the doc. Self-contained — return early.
    if (mode === 'append') {
      await this._runWebAppend(prompt, cwd);
      return;
    }

    // Pin the write to the tab that's active now. A single CodeMirror instance
    // is shared across tabs, so without this the stream would follow focus and
    // land in whichever doc the user switches to mid-write.
    this.writeTabId = this.tabManager ? this.tabManager.activeTabId : null;

    // Remember cursor position for streaming
    if (mode === 'cursor' || mode === 'new') {
      this.writeStartCursor = this.host.getCursor();
    } else if (mode === 'replace') {
      // Capture the selection range, then delete it before streaming in.
      const range = this.host.getSelectionRange();
      this.writeSelectionStart = range.from;
      this.writeSelectionEnd = range.to;
      this.host.replaceSelection('');
      this.writeStartCursor = this.host.getCursor();
    } else if (mode === 'append') {
      // Move cursor to end of document, then add newlines before appending.
      this.host.setCursorToEnd();
      this.host.replaceSelection('\n\n');
      this.writeStartCursor = this.host.getCursor();
    }

    // Build the prompt with context if needed
    let finalPrompt = prompt;
    if (mode === 'replace') {
      // Use the text captured before deletion (selection is gone now)
      finalPrompt = `Rewrite/improve the following text based on this instruction: "${prompt}"\n\nOriginal text:\n${selectedText}\n\nProvide ONLY the rewritten text, no explanations.`;
    } else if (mode !== 'new') {
      // For cursor/append, provide document context
      const docContent = this.host.getContent();
      if (docContent.trim()) {
        finalPrompt = `Context - current document:\n---\n${docContent}\n---\n\nTask: ${prompt}\n\nProvide ONLY the content to insert, no explanations or markdown code blocks.`;
      }
    }

    this.state.isClaudeRunning = true;
    this.terminalStop.classList.remove('hidden');
    this.showThinkingIndicator();

    try {
      await window.vomit.claudeExecute(finalPrompt, cwd);
    } catch (err) {
      this.hideThinkingIndicator();
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
      this.writeMode = null;
      this.state.isClaudeRunning = false;
      this.terminalStop.classList.add('hidden');
    }
  }

  // Research the web via the agent (tools enabled) and insert the resulting
  // document body into the already-created /write-new doc, then save it. Tool
  // activity streams to the terminal; only the final body goes into the editor.
  async _runWebWriteNew(prompt, cwd, newPath) {
    // Not the live streaming path — agent output goes to the terminal, not the
    // editor, so keep writeMode off.
    this.writeMode = null;
    this.appendTerminalOutput('Researching the web and writing…', 'system');
    this.state.isClaudeRunning = true;
    this.terminalStop.classList.remove('hidden');
    this.showThinkingIndicator();

    let content = '';
    try {
      content = await window.vomit.agentExecuteEditor(prompt, cwd);
    } catch (err) {
      this.appendTerminalOutput(`Error: ${err.message || err}`, 'error');
    } finally {
      this.hideThinkingIndicator();
      this.state.isClaudeRunning = false;
      this.terminalStop.classList.add('hidden');
    }

    content = this.stripMarkdownCodeFence(content || '').trim();
    if (!content) {
      this.appendTerminalOutput('No content was generated.', 'system');
      this.writeNewPath = null;
      return;
    }

    // Make sure the new doc is the active tab before inserting.
    if (this.writeTabId && this.tabManager &&
        this.tabManager.activeTabId !== this.writeTabId &&
        this.tabManager.tabs.has(this.writeTabId)) {
      this.tabManager.switchToTab(this.writeTabId);
    }
    this.host.setCursorToEnd();
    this.host.replaceSelection(content);

    // Tidy any tables the research produced, then persist to disk.
    window.dispatchEvent(new CustomEvent('vomit:format-tables'));
    try {
      await window.vomit.writeFile(newPath, this.host.getContent());
      this.state.isDirty = false;
      if (this.tabManager) this.tabManager.markCurrentTabClean();
      this.appendTerminalOutput(`✓ Written and saved ${window.PathUtils.basename(newPath)}`, 'output');
    } catch (err) {
      this.appendTerminalOutput(`Error saving file: ${err.message || err}`, 'error');
    }

    this.writeNewPath = null;
    this.writeTabId = null;
    this.host.focus();
  }

  // Research the web and append new, doc-aware content to the end of the
  // current document, then save it (if it has a path).
  async _runWebAppend(prompt, cwd) {
    this.writeMode = null;

    const targetTabId = this.tabManager ? this.tabManager.activeTabId : null;
    const targetPath = this.state.currentFilePath || null;
    const existing = this.host.getContent();

    // Give the agent the current document so it extends rather than repeats it.
    const researchPrompt = `Here is the current document:\n---\n${existing}\n---\n\nWrite ONLY the additional Markdown content to append to it, based on this instruction: "${prompt}". Do not repeat existing content, and do not restate the title or frontmatter. Continue naturally from where the document ends.`;

    this.appendTerminalOutput('Researching the web and writing…', 'system');
    this.state.isClaudeRunning = true;
    this.terminalStop.classList.remove('hidden');
    this.showThinkingIndicator();

    let content = '';
    try {
      content = await window.vomit.agentExecuteEditor(researchPrompt, cwd);
    } catch (err) {
      this.appendTerminalOutput(`Error: ${err.message || err}`, 'error');
    } finally {
      this.hideThinkingIndicator();
      this.state.isClaudeRunning = false;
      this.terminalStop.classList.add('hidden');
    }

    content = this.stripMarkdownCodeFence(content || '').trim();
    if (!content) {
      this.appendTerminalOutput('No content was generated.', 'system');
      return;
    }

    // Append to the doc the command started on.
    if (targetTabId && this.tabManager &&
        this.tabManager.activeTabId !== targetTabId &&
        this.tabManager.tabs.has(targetTabId)) {
      this.tabManager.switchToTab(targetTabId);
    }
    this.host.setCursorToEnd();
    this.host.replaceSelection(`\n\n${content}`);

    // Tidy tables, then persist if the doc is saved on disk.
    window.dispatchEvent(new CustomEvent('vomit:format-tables'));
    if (targetPath) {
      try {
        await window.vomit.writeFile(targetPath, this.host.getContent());
        this.state.isDirty = false;
        if (this.tabManager) this.tabManager.markCurrentTabClean();
        this.appendTerminalOutput(`✓ Appended and saved ${window.PathUtils.basename(targetPath)}`, 'output');
      } catch (err) {
        this.appendTerminalOutput(`Error saving file: ${err.message || err}`, 'error');
      }
    } else {
      this.appendTerminalOutput('✓ Appended (unsaved — press Cmd+S to save).', 'output');
    }

    this.host.focus();
  }

  // Recursively gather markdown/text files under a directory. Hidden folders
  // are already excluded by getDirectoryContents; a few build dirs are skipped
  // explicitly. Bounded by depth and count to stay responsive.
  async _collectTextFiles(dir, acc = [], depth = 0) {
    const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', '.git', 'vendor']);
    if (depth > 8 || acc.length >= 300) return acc;
    let items = [];
    try {
      items = await window.vomit.getDirectoryContents(dir);
    } catch {
      return acc;
    }
    for (const it of items) {
      if (acc.length >= 300) break;
      if (it.isDirectory) continue;
      const lower = it.name.toLowerCase();
      if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) {
        acc.push(it);
      }
    }
    for (const it of items) {
      if (acc.length >= 300) break;
      if (it.isDirectory && !SKIP_DIRS.has(it.name.toLowerCase())) {
        await this._collectTextFiles(it.path, acc, depth + 1);
      }
    }
    return acc;
  }

  // Resolve the folder currently in focus in the explorer tree (mirrors the
  // file tree's own "create new file" logic): a focused directory → itself, a
  // focused file → its parent; falling back to the open doc's folder, then root.
  _resolveCurrentFolder(cwd) {
    const ftm = this.fileTreeManager;
    if (ftm && ftm.treeState && ftm.dataModel && ftm.treeState.focusedPath) {
      const node = ftm.dataModel.getNode(ftm.treeState.focusedPath);
      if (node) {
        return node.isDirectory ? node.path : node.parentPath;
      }
    }
    if (this.state.currentFilePath) {
      return window.PathUtils.dirname(this.state.currentFilePath);
    }
    return (ftm && ftm.treeState && ftm.treeState.rootPath) || cwd;
  }

  // Summarize the current folder (or an optional subfolder) and everything
  // beneath it into a new saved Markdown document.
  async summarizeFolder(args, cwd) {
    const arg = (args || '').trim();
    this.appendTerminalOutput(`❯ /summarize-folder${arg ? ' ' + arg : ''}`, 'input');

    // Resolve the "current folder" the same way the file tree does, so it
    // matches what's selected in the sidebar. An explicit arg is treated as a
    // subfolder of that current folder.
    const baseFolder = this._resolveCurrentFolder(cwd);
    const targetDir = arg ? window.PathUtils.join(baseFolder, arg) : baseFolder;

    this.appendTerminalOutput(`Scanning ${targetDir} (including subfolders)…`, 'system');
    const files = await this._collectTextFiles(targetDir);
    if (files.length === 0) {
      this.appendTerminalOutput('No markdown or text files found to summarize.', 'error');
      return;
    }
    this.appendTerminalOutput(`Found ${files.length} file(s). Reading…`, 'system');

    // Read files into a bounded corpus.
    const PER_FILE = 4000;
    const TOTAL = 60000;
    let corpus = '';
    let included = 0;
    for (const f of files) {
      if (corpus.length >= TOTAL) break;
      let content = '';
      try {
        content = await window.vomit.readFile(f.path);
      } catch {
        continue;
      }
      let snippet = content.length > PER_FILE
        ? content.slice(0, PER_FILE) + '\n…(truncated)'
        : content;
      const rel = window.PathUtils.relativeParts(f.path, targetDir).join('/') || f.name;
      const block = `\n\n### FILE: ${rel}\n${snippet}`;
      corpus += block.length > TOTAL - corpus.length
        ? block.slice(0, TOTAL - corpus.length)
        : block;
      included++;
    }
    if (included < files.length) {
      this.appendTerminalOutput(`Note: summarizing ${included} of ${files.length} files (size cap reached).`, 'system');
    }

    // Create the summary document (frontmatter + saved tab).
    const folderName = window.PathUtils.basename(targetDir) || 'folder';
    const newPath = await this.resolveNewDocPath(targetDir, `${folderName}-summary`);
    if (!newPath || !this.tabManager) {
      this.appendTerminalOutput('Could not create a summary document here.', 'error');
      return;
    }
    const frontmatter = this._buildFrontmatter(newPath, targetDir);
    try {
      await window.vomit.writeFile(newPath, frontmatter);
    } catch (err) {
      this.appendTerminalOutput(`Error creating file: ${err.message || err}`, 'error');
      return;
    }
    this.tabManager.createTab(newPath, frontmatter);
    if (this.fileTreeManager && this.fileTreeManager.refreshFolder) {
      this.fileTreeManager.refreshFolder(targetDir);
    }

    const prompt = `You are summarizing a folder of documents named "${folderName}" (including its subfolders). Below are the files with their relative paths and contents.

Produce a clear, well-structured Markdown summary of the whole folder. Include:
- A short overview of what the folder contains.
- The main themes and topics across the documents.
- A breakdown by subfolder or area where useful.
- Any notable decisions, conclusions, or action items.

Output ONLY the summary in GitHub-Flavored Markdown. Do not wrap it in code fences and do not add YAML frontmatter.

FILES:
${corpus}`;

    // Stream the summary into the new doc using the write-mode machinery, which
    // also saves it and tidies tables on completion (mode 'new' + writeNewPath).
    this.writeMode = 'new';
    this.writeBuffer = '';
    this.writeNewPath = newPath;
    this.writeTabId = this.tabManager.activeTabId;
    this.host.setCursorToEnd();
    this.writeStartCursor = this.host.getCursor();

    this.appendTerminalOutput(`Summarizing into ${window.PathUtils.basename(newPath)}…`, 'system');
    this.state.isClaudeRunning = true;
    this.terminalStop.classList.remove('hidden');
    this.showThinkingIndicator();
    try {
      await window.vomit.claudeExecute(prompt, cwd);
    } catch (err) {
      this.hideThinkingIndicator();
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
      this.writeMode = null;
      this.writeNewPath = null;
      this.state.isClaudeRunning = false;
      this.terminalStop.classList.add('hidden');
    }
  }

  streamToEditor(text) {
    if (!this.writeMode) return;

    // Keep the stream pinned to the tab the command started on. If the user
    // switched tabs mid-write, snap back so the content lands in the intended
    // doc rather than the now-focused one.
    if (this.writeTabId && this.tabManager &&
        this.tabManager.activeTabId !== this.writeTabId) {
      if (!this.tabManager.tabs.has(this.writeTabId)) {
        // Target tab was closed — abort the write rather than corrupt another doc.
        this.writeMode = null;
        this.appendTerminalOutput('Write cancelled: target document was closed.', 'error');
        return;
      }
      this.tabManager.switchToTab(this.writeTabId);
      // Continue inserting where the stream left off in the target doc.
      if (this.writeStartCursor) {
        this.host.setCursor(this.writeStartCursor);
      }
    }

    // Insert the new text at current cursor position
    this.host.replaceSelection(text);

    // Track the cursor so a later snap-back resumes at the right spot.
    this.writeStartCursor = this.host.getCursor();
  }

  finalizeWriteMode(wasStopped) {
    if (!this.writeMode) return;

    const mode = this.writeMode;
    this.writeMode = null;

    // Mark terminal output as complete
    this.markOutputComplete();

    if (wasStopped) {
      this.appendTerminalOutput('Stopped.', 'system');
    } else {
      const modeLabels = {
        cursor: 'inserted at cursor',
        new: 'written to new file',
        replace: 'replaced selection',
        append: 'appended to document'
      };
      this.appendTerminalOutput(`✓ Content ${modeLabels[mode]}`, 'output');
      // Tidy up any tables the AI produced.
      window.dispatchEvent(new CustomEvent('vomit:format-tables'));
    }

    // For /write-new, persist the streamed content to the file we created so the
    // doc is saved even when auto-save is off.
    if (mode === 'new' && this.writeNewPath) {
      const path = this.writeNewPath;
      const isActiveDoc = this.tabManager && this.tabManager.activeTabId &&
        this.tabManager.tabs.get(this.tabManager.activeTabId)?.filePath === path;
      window.vomit.writeFile(path, this.host.getContent())
        .then(() => {
          if (isActiveDoc) {
            this.state.isDirty = false;
            this.tabManager.markCurrentTabClean();
          }
          this.appendTerminalOutput(`Saved ${window.PathUtils.basename(path)}`, 'system');
        })
        .catch((err) => {
          this.appendTerminalOutput(`Error saving file: ${err.message || err}`, 'error');
        });
    }

    this.writeBuffer = '';
    this.writeStartCursor = null;
    this.writeTabId = null;
    this.writeNewPath = null;

    // Focus the editor
    this.host.focus();
  }

  stripMarkdownCodeFence(text) {
    const trimmed = (text || '').trim();
    const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
    return match ? match[1].trim() : trimmed;
  }

  async formatToMarkdown(instruction, cwd) {
    const extraInstruction = (instruction || '').trim();
    const cmdLine = extraInstruction ? `/format-to-md ${extraInstruction}` : '/format-to-md';
    this.appendTerminalOutput(`❯ ${cmdLine}`, 'input');
    this.appendTerminalOutput('Formatting pasted Word text as Markdown...', 'system');

    const hasSelection = this.host.somethingSelected();
    const originalText = hasSelection ? this.host.getSelection() : this.host.getContent();

    if (!originalText.trim()) {
      this.appendTerminalOutput(
        hasSelection ? 'Error: Selected text is empty.' : 'Error: Document is empty.',
        'error'
      );
      return;
    }

    const range = hasSelection ? this.host.getSelectionRange() : null;
    const selectionFrom = range ? range.from : null;
    const selectionTo = range ? range.to : null;
    const finalPrompt = `Convert the following content pasted from Microsoft Word into clean Markdown.

Rules:
- Preserve the original meaning, structure, headings, lists, links, and tables where possible.
- Remove Word-specific artifacts, strange spacing, redundant blank lines, page headers/footers, and decorative formatting.
- Use standard Markdown only.
- Do not summarize or add new content.
- Return ONLY the Markdown content, with no explanations and no fenced code block.
${extraInstruction ? `- Additional instruction: ${extraInstruction}\n` : ''}
Content:
---
${originalText}
---`;

    this.state.isClaudeRunning = true;
    this.terminalStop.classList.remove('hidden');
    this.showThinkingIndicator();
    this.state.pseudoOutput = '';
    this.state.pseudoCollecting = true;

    try {
      await window.vomit.claudeExecute(finalPrompt, cwd);
      await this.waitForAIComplete();

      const formatted = this.stripMarkdownCodeFence(this.state.pseudoOutput);
      if (!formatted.trim()) {
        this.appendTerminalOutput('Error: AI returned empty Markdown.', 'error');
        return;
      }

      if (hasSelection) {
        this.host.replaceRange(formatted, selectionFrom, selectionTo);
        this.appendTerminalOutput('✓ Selection formatted as Markdown', 'output');
      } else {
        this.host.setContent(formatted);
        this.appendTerminalOutput('✓ Document formatted as Markdown', 'output');
      }
      this.host.focus();
      this.markOutputComplete();
    } catch (err) {
      this.state.pseudoCollecting = false;
      this.hideThinkingIndicator();
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
      this.state.isClaudeRunning = false;
      this.terminalStop.classList.add('hidden');
    }
  }

  async pseudonymizeCurrentDoc(cwd, mode = 'ai') {
    const normalizedMode = mode === 'deterministic' ? 'deterministic' : 'ai';
    this.appendTerminalOutput(`❯ /pseudo${normalizedMode === 'deterministic' ? ' deterministic' : ''}`, 'input');
    this.appendTerminalOutput(
      normalizedMode === 'deterministic'
        ? 'Pseudonymizing current document (deterministic)...'
        : 'Pseudonymizing current document...',
      'system'
    );

    const docContent = this.host.getContent();
    if (!docContent.trim()) {
      this.appendTerminalOutput('Error: Document is empty.', 'error');
      return;
    }

    // Determine output file paths
    const currentFile = this.state.currentFilePath;
    let outputPath;
    let mappingPath;
    let relativeName;
    if (currentFile) {
      const dir = window.PathUtils.dirname(currentFile);
      const filename = window.PathUtils.basename(currentFile);
      const ext = filename.lastIndexOf('.') > 0 ? filename.substring(filename.lastIndexOf('.')) : '';
      const basename = filename.lastIndexOf('.') > 0 ? filename.substring(0, filename.lastIndexOf('.')) : filename;
      outputPath = window.PathUtils.join(dir, `${basename}-pseudo${ext}`);
      mappingPath = window.PathUtils.join(dir, `${basename}-pseudo.map.json`);
      relativeName = filename;
    } else {
      outputPath = window.PathUtils.join(cwd, 'untitled-pseudo.md');
      mappingPath = window.PathUtils.join(cwd, 'untitled-pseudo.map.json');
      relativeName = 'untitled.md';
    }

    // Deterministic path: build the mapping locally with the same engine the
    // repo commands use — no AI server required.
    if (normalizedMode === 'deterministic') {
      let mapping = {};
      const counters = this.createPseudoCounters(mapping);
      this.scanIacPseudoEntities(docContent, relativeName, mapping, counters);

      const sanitized = this.sanitizePseudoMapping(mapping);
      mapping = sanitized.mapping;

      if (Object.keys(mapping).length === 0) {
        this.appendTerminalOutput('No sensitive data found to anonymize.', 'system');
        return;
      }

      const sortedKeys = Object.keys(mapping).sort((a, b) => b.length - a.length);
      const applied = this.applyPseudoMappingToContent(docContent, sortedKeys, mapping);

      await window.vomit.writeFile(outputPath, applied.content);
      this.appendTerminalOutput(`✓ Saved: ${window.PathUtils.basename(outputPath)}`, 'output');

      await window.vomit.writeFile(mappingPath, JSON.stringify(mapping, null, 2));
      this.appendTerminalOutput(`✓ Mapping saved: ${window.PathUtils.basename(mappingPath)} (${Object.keys(mapping).length} entities)`, 'output');

      const parentDir = window.PathUtils.dirname(outputPath);
      await this.fileTreeManager.refreshFolder(parentDir);
      return;
    }

    const pseudoPrompt = `Analyze this file and identify ALL sensitive/personal data that should be anonymized for GDPR compliance.

Look for:
- Names (people, authors)
- Company/organization names
- Phone numbers
- Email addresses
- IP addresses
- Server/hostnames
- API keys, tokens, passwords
- Database names
- Cloud resource IDs
- GUIDs/UUIDs (e.g. 745c93c0-151d-4cc9-a3d6-xxxxxxxxxxxx)
- Azure/cloud IDs (subscription, tenant, object, resource IDs)
- Paths with usernames

Do NOT map structural IaC/API words or template identifiers such as name, namespace, cluster, basename, cpu, regexp, metadata.name, metadata.namespace, namespaceSelector, clusterResourceWhitelist, namespaceResourceBlacklist, path.basenameNormalized, .Values keys, or YAML/Helm/Kubernetes/ArgoCD field names.

For each item found, provide a fictional replacement.

OUTPUT: Return ONLY a JSON object mapping original values to fake replacements. No other text.

Example output:
{"Annie de Waard": "Sarah Miller", "jan@company.nl": "user@example.com", "192.168.1.1": "10.0.0.1", "745c93c0-151d-4cc9-a3d6-abc123def456": "00000000-0000-0000-0000-000000000001"}

If no sensitive data found, return: {}

File to analyze:
\`\`\`
${docContent}
\`\`\``;

    this.state.isClaudeRunning = true;
    this.terminalStop.classList.remove('hidden');
    this.showThinkingIndicator();

    // Collect the AI output
    this.state.pseudoOutput = '';
    this.state.pseudoCollecting = true;
    this.pseudoOutputPath = outputPath;

    try {
      await window.vomit.claudeExecute(pseudoPrompt, cwd);
      // Wait for completion and save
      await this.waitForAIComplete();

      if (this.state.pseudoOutput.trim()) {
        const output = this.state.pseudoOutput.trim();
        let mapping = null;

        // Parse JSON mapping from AI output
        try {
          const jsonMatch = output.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            mapping = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          this.appendTerminalOutput('Warning: Could not parse mapping JSON', 'error');
        }

        if (mapping && Object.keys(mapping).length > 0) {
          const sanitized = this.sanitizePseudoMapping(mapping);
          mapping = sanitized.mapping;
        }

        if (mapping && Object.keys(mapping).length > 0) {
          // Apply mapping to original content programmatically
          const sortedKeys = Object.keys(mapping).sort((a, b) => b.length - a.length);
          const applied = this.applyPseudoMappingToContent(docContent, sortedKeys, mapping);
          const content = applied.content;

          // Save the pseudonymized content
          await window.vomit.writeFile(outputPath, content);
          this.appendTerminalOutput(`✓ Saved: ${window.PathUtils.basename(outputPath)}`, 'output');

          // Save the mapping
          await window.vomit.writeFile(mappingPath, JSON.stringify(mapping, null, 2));
          this.appendTerminalOutput(`✓ Mapping saved: ${window.PathUtils.basename(mappingPath)}`, 'output');

          // Refresh the parent folder in the file tree
          const parentDir = window.PathUtils.dirname(outputPath);
          await this.fileTreeManager.refreshFolder(parentDir);
        } else {
          this.appendTerminalOutput('No sensitive data found to anonymize.', 'system');
        }
      }
      this.markOutputComplete();
    } catch (err) {
      this.hideThinkingIndicator();
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
      this.state.isClaudeRunning = false;
      this.terminalStop.classList.add('hidden');
    }
  }

  // Pseudonymize the current editor selection (or whole document if nothing is
  // selected) and print the result inline in the terminal. Nothing is written
  // to disk and the editor is not modified — copy the output from the terminal.
  async pseudonymizeSelection(cwd, mode = 'deterministic') {
    const normalizedMode = mode === 'ai' ? 'ai' : 'deterministic';
    this.appendTerminalOutput(
      `❯ ${normalizedMode === 'ai' ? '/pseudo-text-ai' : '/pseudo-text'}`,
      'input'
    );

    const hasSelection = this.host.somethingSelected();
    const sourceText = hasSelection ? this.host.getSelection() : this.host.getContent();
    if (!sourceText.trim()) {
      this.appendTerminalOutput(
        hasSelection
          ? 'Error: Selected text is empty.'
          : 'Error: Select text in the editor first (or open a document).',
        'error'
      );
      return;
    }

    const printResult = (mapping, content) => {
      // Accumulate into the session map so /pseudo-depseudo-text can reverse it.
      Object.assign(this.pseudoTextMap, mapping);
      const count = Object.keys(mapping).length;
      this.appendTerminalOutput(`✓ Pseudonymized (${count} ${count === 1 ? 'entity' : 'entities'}):`, 'output');
      this.appendTerminalOutput(content, 'output');
      this.appendTerminalOutput('Reverse with /pseudo-depseudo-text (select the pseudonymized text first).', 'system');
    };

    // Deterministic: build the mapping locally with the same engine the repo
    // commands use — no AI server required.
    if (normalizedMode === 'deterministic') {
      let mapping = {};
      const counters = this.createPseudoCounters(mapping);
      this.scanIacPseudoEntities(sourceText, 'selection.md', mapping, counters);
      mapping = this.sanitizePseudoMapping(mapping).mapping;

      if (Object.keys(mapping).length === 0) {
        this.appendTerminalOutput('No sensitive data found to anonymize.', 'system');
        return;
      }

      const sortedKeys = Object.keys(mapping).sort((a, b) => b.length - a.length);
      const applied = this.applyPseudoMappingToContent(sourceText, sortedKeys, mapping);
      printResult(mapping, applied.content);
      return;
    }

    // AI mode: ask the model for a mapping, then apply it programmatically so
    // the returned text is a faithful copy of the input with values swapped.
    const pseudoPrompt = `Analyze this text and identify ALL sensitive/personal data that should be anonymized for GDPR compliance.

Look for:
- Names (people, authors)
- Company/organization names
- Phone numbers
- Email addresses
- IP addresses
- Server/hostnames
- API keys, tokens, passwords
- Database names
- Cloud resource IDs
- GUIDs/UUIDs (e.g. 745c93c0-151d-4cc9-a3d6-xxxxxxxxxxxx)
- Azure/cloud IDs (subscription, tenant, object, resource IDs)
- Paths with usernames

Do NOT map structural IaC/API words or template identifiers such as name, namespace, cluster, basename, cpu, regexp, metadata.name, metadata.namespace, namespaceSelector, clusterResourceWhitelist, namespaceResourceBlacklist, path.basenameNormalized, .Values keys, or YAML/Helm/Kubernetes/ArgoCD field names.

For each item found, provide a fictional replacement.

OUTPUT: Return ONLY a JSON object mapping original values to fake replacements. No other text.

Example output:
{"Annie de Waard": "Sarah Miller", "jan@company.nl": "user@example.com", "192.168.1.1": "10.0.0.1", "745c93c0-151d-4cc9-a3d6-abc123def456": "00000000-0000-0000-0000-000000000001"}

If no sensitive data found, return: {}

Text to analyze:
\`\`\`
${sourceText}
\`\`\``;

    this.state.isClaudeRunning = true;
    this.terminalStop.classList.remove('hidden');
    this.showThinkingIndicator();
    this.state.pseudoOutput = '';
    this.state.pseudoCollecting = true;

    try {
      await window.vomit.claudeExecute(pseudoPrompt, cwd);
      await this.waitForAIComplete();

      const output = this.state.pseudoOutput.trim();
      let mapping = null;
      try {
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (jsonMatch) mapping = JSON.parse(jsonMatch[0]);
      } catch (e) {
        this.appendTerminalOutput('Warning: Could not parse mapping JSON', 'error');
      }

      if (mapping && Object.keys(mapping).length > 0) {
        mapping = this.sanitizePseudoMapping(mapping).mapping;
      }

      if (mapping && Object.keys(mapping).length > 0) {
        const sortedKeys = Object.keys(mapping).sort((a, b) => b.length - a.length);
        const applied = this.applyPseudoMappingToContent(sourceText, sortedKeys, mapping);
        printResult(mapping, applied.content);
      } else {
        this.appendTerminalOutput('No sensitive data found to anonymize.', 'system');
      }
      this.markOutputComplete();
    } catch (err) {
      this.state.pseudoCollecting = false;
      this.hideThinkingIndicator();
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
      this.state.isClaudeRunning = false;
      this.terminalStop.classList.add('hidden');
    }
  }

  // Reverse the current editor selection using the session mapping built by
  // /pseudo-text and /pseudo-text-ai. Prints the restored text in the terminal.
  async depseudonymizeSelection() {
    this.appendTerminalOutput('❯ /pseudo-depseudo-text', 'input');

    const entries = Object.entries(this.pseudoTextMap || {});
    if (entries.length === 0) {
      this.appendTerminalOutput('Error: No mapping this session. Run /pseudo-text or /pseudo-text-ai first.', 'error');
      return;
    }

    const hasSelection = this.host.somethingSelected();
    const sourceText = hasSelection ? this.host.getSelection() : this.host.getContent();
    if (!sourceText.trim()) {
      this.appendTerminalOutput(
        hasSelection
          ? 'Error: Selected text is empty.'
          : 'Error: Select the pseudonymized text in the editor first (or open a document).',
        'error'
      );
      return;
    }

    // Invert real→fake into fake→real, then apply with the same engine.
    const reverse = {};
    for (const [real, fake] of entries) {
      if (typeof fake === 'string' && fake.trim()) reverse[fake] = real;
    }

    const sortedKeys = Object.keys(reverse).sort((a, b) => b.length - a.length);
    const applied = this.applyPseudoMappingToContent(sourceText, sortedKeys, reverse);

    if (!applied.changed) {
      this.appendTerminalOutput('No pseudonymized values from this session found in the selection.', 'system');
      return;
    }

    this.appendTerminalOutput('✓ Restored:', 'output');
    this.appendTerminalOutput(applied.content, 'output');
  }

  async depseudonymizeCurrentDoc() {
    this.appendTerminalOutput('❯ /pseudo-depseudo', 'input');

    const currentFile = this.state.currentFilePath;
    if (!currentFile) {
      this.appendTerminalOutput('Error: No file open. Open a file first.', 'error');
      return;
    }

    // Determine mapping file path and original file path
    const dir = window.PathUtils.dirname(currentFile);
    const filename = window.PathUtils.basename(currentFile);
    const ext = filename.lastIndexOf('.') > 0 ? filename.substring(filename.lastIndexOf('.')) : '';
    const basename = filename.lastIndexOf('.') > 0 ? filename.substring(0, filename.lastIndexOf('.')) : filename;

    let mappingPath;
    let originalPath;

    if (basename.endsWith('-pseudo')) {
      // Current file is a pseudo file - find original
      const originalBasename = basename.replace(/-pseudo$/, '');
      mappingPath = `${dir}/${basename}.map.json`;
      originalPath = `${dir}/${originalBasename}${ext}`;
    } else {
      this.appendTerminalOutput('Error: This doesn\'t appear to be a pseudonymized file.', 'error');
      this.appendTerminalOutput('Open a *-pseudo.md file to run /pseudo-depseudo.', 'system');
      return;
    }

    try {
      // Read the mapping file
      const mappingContent = await window.vomit.readFile(mappingPath);

      if (!mappingContent) {
        this.appendTerminalOutput(`Error: No mapping found at ${window.PathUtils.basename(mappingPath)}`, 'error');
        this.appendTerminalOutput('Run /pseudo first to create a mapping.', 'system');
        return;
      }

      const mapping = JSON.parse(mappingContent);
      const reverseMapping = {};

      // Reverse the mapping: fake → original
      for (const [original, fake] of Object.entries(mapping)) {
        reverseMapping[fake] = original;
      }

      // Get current content (from pseudo file) and apply reverse mapping
      let content = this.host.getContent();
      let replacements = 0;

      // Sort by length (longest first) to avoid partial replacements
      const fakeValues = Object.keys(reverseMapping).sort((a, b) => b.length - a.length);

      for (const fake of fakeValues) {
        const original = reverseMapping[fake];
        const nextContent = this.replacePseudoToken(content, fake, original);
        if (nextContent !== content) {
          replacements++;
          content = nextContent;
        }
      }

      // Write to the ORIGINAL file
      await window.vomit.writeFile(originalPath, content);
      this.appendTerminalOutput(`✓ Restored ${replacements} values.`, 'output');
      this.appendTerminalOutput(`✓ Updated: ${window.PathUtils.basename(originalPath)}`, 'output');

      // Refresh file tree
      this.fileTreeManager.loadFileTree();

      // Check if original file is already open in a tab
      const tm = this.tabManager;
      if (tm) {
        const existingTab = tm.getTabByPath(originalPath);
        if (existingTab) {
          // Update the tab's content directly
          existingTab.content = content;
          existingTab.isDirty = false;
          // If it's the active tab, update the editor
          if (existingTab.id === tm.activeTabId) {
            this.host.setContent(content);
            this.state.isDirty = false;
            this.previewManager.updatePreview();
            this.previewManager.updateStatus();
          }
          tm.switchToTab(existingTab.id);
        } else {
          // Open the original file in a new tab
          window.vomit.openFile(originalPath);
        }
      } else {
        window.vomit.openFile(originalPath);
      }
    } catch (err) {
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
      this.appendTerminalOutput('Make sure the .map.json file exists and is valid JSON.', 'system');
    }
  }

  // --- Pseudo-repo workflow (multi-repo bucket pseudonymization) ---

  getPseudoTargetExtensions() {
    return ['.tf', '.tfvars', '.yaml', '.yml', '.json', '.md', '.markdown', '.txt', '.text', '.adoc', '.rst', '.env', '.sh', '.ps1', '.py', '.js', '.ts', '.tsx', '.jsx', '.go', '.cs', '.fs', '.vb', '.csproj', '.fsproj', '.vbproj', '.sln', '.props', '.targets', '.config', '.hcl', '.bicep', '.toml', '.xml', '.sql', '.ini', '.dockerfile', '.tpl'];
  }

  getPseudoSkipDirs() {
    return new Set(['.git', '.terraform', '.terragrunt-cache', 'node_modules', 'pseudo', 'pseudonymized', 'dist', 'build', 'bin', 'obj', '.next', 'coverage', 'vendor']);
  }

  normalizePseudoTargetFolder(targetFolder) {
    const value = String(targetFolder || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!value) return null;

    const parts = value.split('/').filter(Boolean);
    if (parts.some(part => part === '.' || part === '..')) return null;
    return parts.join('/');
  }

  async resolvePseudoTargetFolder(cwd, targetFolder) {
    const normalized = this.normalizePseudoTargetFolder(targetFolder);
    if (!normalized) return null;

    let currentPath = cwd;
    for (const part of normalized.split('/')) {
      const items = await window.vomit.getDirectoryContents(currentPath);
      const match = items.find(item => item.isDirectory && item.name === part);
      if (!match) return null;
      currentPath = match.path;
    }

    return { name: normalized, path: currentPath };
  }

  createPseudoCounters(mapping) {
    const counters = {};
    for (const value of Object.values(mapping)) {
      if (typeof value !== 'string') continue;
      const match = value.match(/(\d+)(?!.*\d)/);
      if (!match) continue;
      const prefix = value.slice(0, match.index);
      const n = Number(match[1]);
      if (Number.isFinite(n)) counters[prefix] = Math.max(counters[prefix] || 0, n);
    }
    return counters;
  }

  nextPseudoNumber(counters, prefix) {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return counters[prefix];
  }

  fakePseudoGuid(n) {
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0').slice(-12)}`;
  }

  createPseudoReplacement(category, counters) {
    switch (category) {
      case 'email':
        return `user${String(this.nextPseudoNumber(counters, 'user')).padStart(3, '0')}@example.com`;
      case 'ip': {
        const n = this.nextPseudoNumber(counters, 'ip');
        return `10.254.${Math.floor(n / 250)}.${(n % 250) + 1}`;
      }
      case 'uuid':
        return this.fakePseudoGuid(this.nextPseudoNumber(counters, 'uuid'));
      case 'azureResourceId': {
        const n = this.nextPseudoNumber(counters, 'resource-id');
        return `/subscriptions/${this.fakePseudoGuid(n)}/resourceGroups/rg-example-${n}/providers/Microsoft.Example/resources/example-${n}`;
      }
      case 'awsArn': {
        const n = this.nextPseudoNumber(counters, 'arn');
        return `arn:aws:service:region:000000000000:resource/example-${n}`;
      }
      case 'awsAccount': {
        const n = this.nextPseudoNumber(counters, 'account');
        return String(n).padStart(12, '0');
      }
      case 'url':
        return `https://example${this.nextPseudoNumber(counters, 'url')}.invalid`;
      case 'domain':
        return `example${this.nextPseudoNumber(counters, 'domain')}.internal`;
      case 'cidr': {
        const n = this.nextPseudoNumber(counters, 'cidr');
        return `10.254.${n % 200}.0/24`;
      }
      case 'adoOrg':
        return `ado-org-${String(this.nextPseudoNumber(counters, 'ado-org-')).padStart(3, '0')}`;
      case 'adoProject':
        return `ado-project-${String(this.nextPseudoNumber(counters, 'ado-project-')).padStart(3, '0')}`;
      case 'adoRepo':
        return `ado-repo-${String(this.nextPseudoNumber(counters, 'ado-repo-')).padStart(3, '0')}`;
      case 'adoPipeline':
        return `ado-pipeline-${String(this.nextPseudoNumber(counters, 'ado-pipeline-')).padStart(3, '0')}`;
      case 'serviceConnection':
        return `service-connection-${String(this.nextPseudoNumber(counters, 'service-connection-')).padStart(3, '0')}`;
      case 'variableGroup':
        return `variable-group-${String(this.nextPseudoNumber(counters, 'variable-group-')).padStart(3, '0')}`;
      case 'connectionString':
        return `FAKE_CONNECTION_STRING_${String(this.nextPseudoNumber(counters, 'FAKE_CONNECTION_STRING_')).padStart(4, '0')}`;
      case 'database':
        return `database_${String(this.nextPseudoNumber(counters, 'database_')).padStart(3, '0')}`;
      case 'package':
        return `example.package${String(this.nextPseudoNumber(counters, 'example.package')).padStart(3, '0')}`;
      case 'namespace':
        return `Example.App${String(this.nextPseudoNumber(counters, 'Example.App')).padStart(3, '0')}`;
      case 'k8sNamespace':
        return `namespace-${String(this.nextPseudoNumber(counters, 'namespace-')).padStart(3, '0')}`;
      case 'dockerImage':
        return `registry.example.invalid/app/image-${String(this.nextPseudoNumber(counters, 'image-')).padStart(3, '0')}:latest`;
      case 'registry':
        return `registry${String(this.nextPseudoNumber(counters, 'registry')).padStart(3, '0')}.example.invalid`;
      case 'keyVault':
        return `kv-example-${String(this.nextPseudoNumber(counters, 'kv-example-')).padStart(3, '0')}`;
      case 'storageAccount':
        return `stexample${String(this.nextPseudoNumber(counters, 'stexample')).padStart(3, '0')}`;
      case 'secret':
        return `FAKE_SECRET_${String(this.nextPseudoNumber(counters, 'FAKE_SECRET_')).padStart(4, '0')}`;
      default:
        return `resource-${String(this.nextPseudoNumber(counters, 'resource-')).padStart(3, '0')}`;
    }
  }

  shouldSkipPseudoEntity(value, category = 'resource') {
    if (typeof value !== 'string') return true;
    const trimmed = value.trim();
    const maxLength = category === 'secret' ? 10000 : category === 'connectionString' ? 2000 : 1000;
    if (trimmed.length < 3 || trimmed.length > maxLength) return true;
    if (this.isPseudoStructuralIdentifier(trimmed)) return true;
    if (trimmed.includes('${') || trimmed.startsWith('var.') || trimmed.startsWith('local.') || trimmed.startsWith('data.')) return true;
    if (/^(true|false|null|none|default|latest|main|master|dev|test|prod|stage|staging)$/i.test(trimmed)) return true;
    if (/^(example|fake|placeholder|changeme|redacted|dummy)/i.test(trimmed)) return true;
    if (/^(ado-org|ado-project|ado-repo|ado-pipeline|service-connection|variable-group|resource|namespace)-\d+/i.test(trimmed)) return true;
    if (/^(FAKE_SECRET|FAKE_CONNECTION_STRING)_\d+/i.test(trimmed)) return true;
    if (/^(Example\.App|example\.package)\d+/i.test(trimmed)) return true;
    if (/^registry\.example\.invalid|^registry\d+\.example\.invalid|^kv-example-\d+|^stexample\d+/i.test(trimmed)) return true;
    if (/^user\d+@example\.com$/i.test(trimmed)) return true;
    if (/^10\.254\./.test(trimmed)) return true;
    if (/^00000000-0000-4000-8000-/.test(trimmed)) return true;
    return false;
  }

  getPseudoStructuralIdentifiers() {
    return new Set([
      'apiVersion', 'kind', 'metadata', 'spec', 'status', 'data', 'stringData',
      'name', 'namespace', 'namespaces', 'namespaceSelector', 'podSelector',
      'matchLabels', 'matchExpressions', 'selector', 'labels', 'annotations',
      'roleRef', 'subjects', 'subject', 'apiGroup', 'resource', 'resources', 'verbs',
      'cluster', 'clusterResourceWhitelist', 'namespaceResourceBlacklist',
      'destination', 'destinations', 'source', 'sources', 'project',
      'basename', 'basenameNormalized', 'path', 'server', 'repoURL', 'targetRevision',
      'cpu', 'memory', 'limits', 'requests', 'regexp', 'regex',
      'Chart', 'Chart.yaml', 'version', 'appVersion', 'description',
      'Values', 'Release', 'Template', 'Files', 'Capabilities'
    ]);
  }

  isPseudoStructuralIdentifier(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    const structural = this.getPseudoStructuralIdentifiers();
    if (structural.has(trimmed)) return true;
    const normalized = trimmed.toLowerCase();
    for (const identifier of structural) {
      if (identifier.toLowerCase() === normalized) return true;
    }
    return /^(metadata|spec|status|data|stringData|path|roleRef|subjects?)\./.test(trimmed);
  }

  sanitizePseudoMapping(mapping) {
    const sanitized = {};
    let removed = 0;
    for (const [real, fake] of Object.entries(mapping || {})) {
      if (typeof real !== 'string' || typeof fake !== 'string') {
        removed++;
        continue;
      }
      const realValue = real.trim();
      const fakeValue = fake.trim();
      if (!realValue || !fakeValue || this.shouldSkipPseudoEntity(realValue, 'resource')) {
        removed++;
        continue;
      }
      sanitized[realValue] = fakeValue;
    }
    return { mapping: sanitized, removed };
  }

  escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  isPseudoTokenValue(value) {
    return /^[A-Za-z0-9_.-]+$/.test(value);
  }

  replacePseudoToken(content, real, fake) {
    const escaped = this.escapeRegex(real);
    if (this.isPseudoTokenValue(real)) {
      return content.replace(
        new RegExp(`(?<![A-Za-z0-9_.-])${escaped}(?![A-Za-z0-9_.-])`, 'g'),
        fake
      );
    }
    return content.replace(new RegExp(escaped, 'g'), fake);
  }

  applyPseudoMappingToContent(content, sortedKeys, mapping) {
    let nextContent = content;
    let changed = false;

    for (const real of sortedKeys) {
      const fake = mapping[real];
      if (typeof fake !== 'string') continue;
      const before = nextContent;

      if (this.isPseudoTokenValue(real)) {
        const escaped = this.escapeRegex(real);
        nextContent = nextContent.replace(
          new RegExp(`(^|[^A-Za-z0-9_])\\.Values\\.${escaped}(?=\\b|\\.|\\s|\\}|\\)|\\||,)`, 'g'),
          (match, prefix) => `${prefix}(index .Values ${JSON.stringify(fake)})`
        );
      }

      nextContent = this.replacePseudoToken(nextContent, real, fake);
      if (nextContent !== before) changed = true;
    }

    return { content: nextContent, changed };
  }

  addPseudoEntity(mapping, counters, value, category) {
    const real = typeof value === 'string' ? value.trim() : '';
    if (this.shouldSkipPseudoEntity(real, category) || mapping[real]) return false;
    mapping[real] = this.createPseudoReplacement(category, counters);
    return true;
  }

  createPseudoContentChunks(content, chunkSize = 12000) {
    const text = String(content || '');
    if (text.length <= chunkSize) return [text];

    const chunks = [];
    for (let start = 0; start < text.length; start += chunkSize) {
      chunks.push(text.slice(start, start + chunkSize));
    }
    return chunks;
  }

  scanIacPseudoEntities(content, relativePath, mapping, counters) {
    let added = 0;
    const add = (value, category) => {
      if (this.addPseudoEntity(mapping, counters, value, category)) added++;
    };
    const addDockerImage = (value) => {
      if (!value) return;
      add(value, 'dockerImage');
      const registry = String(value).split('/')[0];
      if (registry && /[.:]/.test(registry) && !registry.includes('://')) {
        add(registry, 'registry');
      }
    };

    const collect = (regex, category, groupIndex = 0) => {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(content)) !== null) {
        add(match[groupIndex], category);
      }
    };

    collect(/(?<![:/])\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'email');
    collect(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, 'ip');
    collect(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\/(?:[0-9]|[12]\d|3[0-2])\b/g, 'cidr');
    collect(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, 'uuid');
    collect(/\/subscriptions\/[0-9a-f-]{36}\/[^\s"'`<>),]+/gi, 'azureResourceId');
    collect(/\barn:aws[a-z-]*:[^:\s"'`]+:[^:\s"'`]*:\d{12}:[^\s"'`<>]+/g, 'awsArn');
    collect(/\b(?:aws_)?account(?:_id)?\s*[:=]\s*["'](\d{12})["']/gi, 'awsAccount', 1);
    collect(/\bhttps?:\/\/[^\s"'`<>]+/gi, 'url');
    collect(/\b(?:password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret|access[_-]?key|private[_-]?key)\b\s*[:=]\s*["']([^"'\n]{6,})["']/gi, 'secret', 1);
    collect(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, 'secret');
    collect(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'secret');
    collect(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?|sqlserver):\/\/[^\s"'`<>]+/gi, 'connectionString');
    collect(/["']((?=[^"'\n]*(?:Server|Data Source|Host|Database|Initial Catalog|User Id|Username|Password|AccountKey|SharedAccessKey|DefaultEndpointsProtocol|Endpoint=sb:\/\/))[^"'\n;=]+=[^"'\n]{12,})["']/gi, 'connectionString', 1);
    collect(/\b(?:database|database_name|db_name|initial catalog)\b\s*[:=]\s*["']([^"'\n]{3,})["']/gi, 'database', 1);
    collect(/\b(?:username|user_id|user id|db_user|database_user)\b\s*[:=]\s*["']([^"'\n]{3,})["']/gi, 'resource', 1);
    collect(/https:\/\/([a-z0-9-]{3,24})\.vault\.azure\.net\b/gi, 'keyVault', 1);
    collect(/\b([a-z0-9]{3,24})\.(?:blob|queue|table|file|dfs)\.core\.windows\.net\b/gi, 'storageAccount', 1);
    collect(/\b(?:APPINSIGHTS_INSTRUMENTATIONKEY|APPLICATIONINSIGHTS_CONNECTION_STRING|InstrumentationKey)\b\s*[:=]\s*["']([^"'\n]{6,})["']/gi, 'secret', 1);
    collect(/\b(?:AZURE_CLIENT_ID|AZURE_TENANT_ID|AZURE_SUBSCRIPTION_ID|client_id|tenant_id|subscription_id)\b\s*[:=]\s*["']([0-9a-f-]{36})["']/gi, 'uuid', 1);
    collect(/\b(?:id|spn|uami|umi|mi|app|ag|sg|rg|vnet|snet|nsg|rt|pip|kv|st|sa|acr|aks|aro|vm|nic|lb|fw|dns|zone|quay|devhub|backstage|argocd|eso)-[a-z0-9][a-z0-9-]{2,}\b/gi, 'resource');
    collect(/\b[a-z0-9][a-z0-9-]{1,}\.(?:apps|api)\.[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi, 'domain');
    collect(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:internal|local|corp|lan|fx|cloud|dev|test|example|invalid)\b/gi, 'domain');

    let match;
    const devAzure = /https:\/\/dev\.azure\.com\/([^\/\s"'`?#]+)\/([^\/\s"'`?#]+)/gi;
    while ((match = devAzure.exec(content)) !== null) {
      add(decodeURIComponent(match[1]), 'adoOrg');
      add(decodeURIComponent(match[2]), 'adoProject');
    }

    const visualStudio = /https:\/\/([^.\/\s"'`?#]+)\.visualstudio\.com\/([^\/\s"'`?#]+)/gi;
    while ((match = visualStudio.exec(content)) !== null) {
      add(decodeURIComponent(match[1]), 'adoOrg');
      add(decodeURIComponent(match[2]), 'adoProject');
    }

    const isAdoFile = /azuredevops_|dev\.azure\.com|visualstudio\.com/i.test(content);
    if (isAdoFile) {
      const adoBlockRegex = /\b(?:resource|data)\s+"(azuredevops_[^"]+)"\s+"([^"]+)"\s*\{([\s\S]*?)(?=\n\s*(?:resource|data)\s+"|\n\s*}\s*$|$)/gi;
      while ((match = adoBlockRegex.exec(content)) !== null) {
        const type = match[1].toLowerCase();
        const label = match[2];
        const body = match[3] || '';
        add(label, 'resource');

        const nameMatch = body.match(/\bname\s*=\s*"([^"\n]{3,})"/i);
        if (nameMatch) {
          const category = type.includes('git_repository') ? 'adoRepo'
            : type.includes('build_definition') || type.includes('pipeline') ? 'adoPipeline'
            : type.includes('serviceendpoint') ? 'serviceConnection'
            : type.includes('variable_group') ? 'variableGroup'
            : type.includes('project') ? 'adoProject'
            : 'resource';
          add(nameMatch[1], category);
        }
      }

      const adoValueRegex = /\b(name|project_name|repository_name|repo_name|pipeline_name|service_endpoint_name|service_connection_name|variable_group_name|agent_pool_name|feed_name|environment_name)\s*=\s*"([^"\n]{3,})"/gi;
      while ((match = adoValueRegex.exec(content)) !== null) {
        const key = match[1].toLowerCase();
        const value = match[2];
        const category = key.includes('project') ? 'adoProject'
          : key.includes('repo') ? 'adoRepo'
          : key.includes('pipeline') ? 'adoPipeline'
          : key.includes('service') ? 'serviceConnection'
          : key.includes('variable_group') ? 'variableGroup'
          : key.includes('agent_pool') ? 'resource'
          : key.includes('feed') ? 'resource'
          : key.includes('environment') ? 'resource'
          : 'adoProject';
        add(value, category);
      }

      const adoBlockLabel = /\b(?:resource|data)\s+"azuredevops_[^"]+"\s+"([^"]+)"/gi;
      while ((match = adoBlockLabel.exec(content)) !== null) {
        add(match[1], 'resource');
      }
    }

    const iacNameRegex = /\b(?:resource_group_name|key_vault_name|storage_account_name|server_name|hostname|host_name|database_name|workspace_name)\s*=\s*"([^"\n]{3,})"/gi;
    while ((match = iacNameRegex.exec(content)) !== null) {
      add(match[1], match[0].toLowerCase().includes('host') ? 'domain' : 'resource');
    }

    const lowerPath = (relativePath || '').toLowerCase();
    const isDotNetFile = /\.(cs|fs|vb|csproj|fsproj|vbproj|sln|props|targets|config|json)$/i.test(lowerPath);
    if (isDotNetFile) {
      collect(/\bnamespace\s+([A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)+)/g, 'namespace', 1);
      collect(/<(?:RootNamespace|AssemblyName|PackageId|Product|Company)>([^<]{3,})<\/(?:RootNamespace|AssemblyName|PackageId|Product|Company)>/gi, 'package', 1);
      collect(/<UserSecretsId>([^<]{6,})<\/UserSecretsId>/gi, 'secret', 1);
      collect(/["'](?:ConnectionStrings:[^"']+|DefaultConnection|ApplicationInsights:[^"']+)["']\s*[:=]\s*["']([^"'\n]{6,})["']/gi, 'connectionString', 1);
      collect(/^\s*(?:Project\([^)]*\)\s*=\s*)?"([^"]{3,})",\s*"[^"]+\.(?:csproj|fsproj|vbproj)"/gmi, 'package', 1);
    }

    const isPythonFile = /\.(py|toml|ini|env|yaml|yml|json)$/i.test(lowerPath) || lowerPath.endsWith('requirements.txt');
    if (isPythonFile) {
      collect(/\b(?:SECRET_KEY|DATABASE_URL|REDIS_URL|CELERY_BROKER_URL|BROKER_URL|SQLALCHEMY_DATABASE_URI)\s*=\s*["']([^"'\n]{6,})["']/g, 'secret', 1);
      collect(/\bDJANGO_SETTINGS_MODULE\s*=\s*["']([^"'\n]{3,})["']/g, 'namespace', 1);
      collect(/^\s*name\s*=\s*["']([A-Za-z0-9_.-]{3,})["']/gmi, 'package', 1);
      collect(/\bsetup\s*\([\s\S]*?\bname\s*=\s*["']([A-Za-z0-9_.-]{3,})["']/gmi, 'package', 1);
    }

    const isKubernetesFile = /apiVersion\s*:|kind\s*:|helm\.sh|containers\s*:|ingress/i.test(content);
    if (isKubernetesFile) {
      collect(/^\s*namespace\s*:\s*["']?([A-Za-z0-9_.-]{3,})["']?/gmi, 'k8sNamespace', 1);
      collect(/^\s*name\s*:\s*["']?([A-Za-z0-9_.-]{3,})["']?/gmi, 'resource', 1);
      collect(/^\s*host\s*:\s*["']?([^"'\s]+)["']?/gmi, 'domain', 1);
      const k8sImageRegex = /^\s*image\s*:\s*["']?([^"'\s]+)["']?/gmi;
      while ((match = k8sImageRegex.exec(content)) !== null) addDockerImage(match[1]);
    }

    const dockerFromRegex = /^\s*FROM\s+([^\s]+)(?:\s+AS\s+\S+)?\s*$/gmi;
    while ((match = dockerFromRegex.exec(content)) !== null) addDockerImage(match[1]);

    const dockerImageRegex = /\b(?:image|container_image|docker_image)\s*[:=]\s*["']?([^"'\s]+\/[^"'\s]+(?::[^"'\s]+)?)["']?/gi;
    while ((match = dockerImageRegex.exec(content)) !== null) addDockerImage(match[1]);

    collect(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|dev|cloud|local|internal|corp|nl|be|de|fr|uk|us|fx)\b/gi, 'domain');

    return added;
  }

  async runPseudoRepo(cwd, targetFolder = null, mode = 'deterministic', commandName = '/pseudo-deterministic') {
    const normalizedMode = mode === 'ai' ? 'ai' : 'deterministic';
    this.appendTerminalOutput(`❯ ${commandName}${targetFolder ? ' ' + targetFolder : ''}`, 'input');

    try {
      // 1. Resolve the target. An explicit folder can be a repo or a plain docs folder.
      let repos = [];
      if (targetFolder) {
        this.appendTerminalOutput(`Resolving target folder: ${targetFolder}`, 'system');
        const target = await this.resolvePseudoTargetFolder(cwd, targetFolder);
        if (!target) {
          this.appendTerminalOutput(`Error: Folder "${targetFolder}" not found in this bucket.`, 'error');
          const rawTarget = String(targetFolder).trim();
          const bucketName = window.PathUtils.basename(cwd);
          const normalizedTarget = this.normalizePseudoTargetFolder(rawTarget);
          const firstPart = normalizedTarget ? normalizedTarget.split('/')[0] : null;
          if (rawTarget.startsWith('~') || rawTarget.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rawTarget)) {
            this.appendTerminalOutput(`Hint: the folder must be a path relative to the bucket root (${cwd}), not an absolute or ~ path.`, 'system');
          } else if (firstPart === bucketName) {
            const withoutBucket = normalizedTarget.split('/').slice(1).join('/');
            this.appendTerminalOutput(`Hint: the path is resolved inside the bucket "${bucketName}" — don't repeat the bucket name. Try: ${commandName}${withoutBucket ? ' ' + withoutBucket : ''}`, 'system');
          } else {
            this.appendTerminalOutput(`Hint: the folder must be a path relative to the bucket root (${cwd}). Names are matched exactly (case-sensitive).`, 'system');
          }
          this.appendTerminalOutput('Available top-level folders:', 'system');
          const items = await window.vomit.getDirectoryContents(cwd);
          const dirs = items.filter(i => i.isDirectory && !i.name.startsWith('.'));
          for (const d of dirs.slice(0, 10)) {
            this.appendTerminalOutput(`  ${d.name}/`, 'system');
          }
          return;
        }

        repos = [target];
        this.appendTerminalOutput(`Targeting: ${target.name}/`, 'system');
      } else {
        this.appendTerminalOutput('Detecting repos in bucket...', 'system');
        repos = await window.vomit.pseudoDetectRepos(cwd);
        if (repos.length === 0) {
          this.appendTerminalOutput(`No git sub-repos found in: ${cwd}`, 'error');
          this.appendTerminalOutput('Expected: top-level subdirectories with .git/', 'system');
          this.appendTerminalOutput('Listing top-level dirs...', 'system');
          const items = await window.vomit.getDirectoryContents(cwd);
          const dirs = items.filter(i => i.isDirectory && !i.name.startsWith('.'));
          for (const d of dirs.slice(0, 10)) {
            this.appendTerminalOutput(`  ${d.name}/`, 'system');
          }
          return;
        }

        this.appendTerminalOutput(`Found ${repos.length} repo(s): ${repos.map(r => r.name).join(', ')}`, 'system');
      }

      // 2. Phase 1 — build shared mapping either locally or with AI assistance.
      this.appendTerminalOutput(
        normalizedMode === 'ai'
          ? '\n── Phase 1: AI-assisted document/entity extraction ──'
          : '\n── Phase 1: Fast deterministic entity scan ──',
        'system'
      );

      let mapping = {};
      // Load existing mapping if re-running
      const existingMapping = await window.vomit.pseudoReadMapping(cwd);
      if (existingMapping) {
        const sanitized = this.sanitizePseudoMapping(existingMapping);
        mapping = sanitized.mapping;
        const removedText = sanitized.removed > 0 ? ` (${sanitized.removed} structural/invalid entries skipped)` : '';
        this.appendTerminalOutput(`Loaded existing mapping (${Object.keys(mapping).length} entities)${removedText}.`, 'system');
      }

      const targetExtensions = this.getPseudoTargetExtensions();
      const counters = this.createPseudoCounters(mapping);
      let totalFiles = 0;
      let totalAdded = 0;

      for (const repo of repos) {
        const files = await this.getFilesRecursively(repo.path, targetExtensions);
        this.appendTerminalOutput(`\n${repo.name}/: ${files.length} files to scan`, 'system');

        for (let i = 0; i < files.length; i++) {
          totalFiles++;
          if (i === 0 || (i + 1) % 25 === 0 || i + 1 === files.length) {
            this.appendTerminalOutput(`  [${i + 1}/${files.length}] Scanning: ${files[i].relativePath}`, 'system');
          }

          const content = await window.vomit.readFile(files[i].path);
          if (!content || content.trim().length === 0) continue;

          let added = this.scanIacPseudoEntities(content, files[i].relativePath, mapping, counters);
          if (normalizedMode === 'ai') {
            const chunks = this.createPseudoContentChunks(content);
            for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
              if (chunks.length > 1) {
                this.appendTerminalOutput(`    AI scan chunk ${chunkIndex + 1}/${chunks.length}`, 'system');
              }

              const extractPrompt = `You are an entity extraction tool for GDPR pseudonymization.

Analyze this file and find ALL sensitive/identifying data NOT already in the known mapping.

Known mapping (do NOT repeat these):
${JSON.stringify(mapping, null, 2)}

Look for NEW instances of:
- Person, team, company, customer, organization, product, project, and code names
- Company and organization names in titles, headers, footers, legal text, document ownership lines, SharePoint/Teams URLs, and certificate/PKI references
- Architecture, system, application, environment, and repository names
- Legal parties, contract references, internal advice context, business processes, and locations
- Email addresses, phone numbers, usernames, and paths with usernames
- IP addresses, FQDNs, hostnames, URLs, and internal domains
- API keys, tokens, passwords, secrets, certificates, and connection strings
- Cloud resource IDs, subscription IDs, tenant IDs, object IDs, GUIDs/UUIDs
- Azure DevOps organizations, projects, repositories, pipelines, service connections, environments, and variable groups

Do NOT map structural IaC/API words or template identifiers such as name, namespace, cluster, basename, cpu, regexp, metadata.name, metadata.namespace, namespaceSelector, clusterResourceWhitelist, namespaceResourceBlacklist, path.basenameNormalized, .Values keys, or YAML/Helm/Kubernetes/ArgoCD field names.

For each NEW entity, provide a realistic fake replacement that preserves the same broad type.

OUTPUT: Return ONLY a JSON object with new mappings. No explanations, no code fences.
Example: {"real-value": "fake-replacement", "another@real.com": "user@example.com"}
If nothing new found, return: {}

File (${files[i].relativePath}${chunks.length > 1 ? `, chunk ${chunkIndex + 1}/${chunks.length}` : ''}):
\`\`\`
${chunks[chunkIndex]}
\`\`\``;

              this.state.pseudoOutput = '';
              this.state.pseudoCollecting = true;

              await window.vomit.claudeExecute(extractPrompt, cwd);
              await this.waitForAIComplete();

              if (this.state.pseudoOutput.trim()) {
                try {
                  const jsonMatch = this.state.pseudoOutput.trim().match(/\{[\s\S]*\}/);
                  if (jsonMatch) {
                    const newEntities = JSON.parse(jsonMatch[0]);
                    for (const [real, fake] of Object.entries(newEntities)) {
                      const realValue = typeof real === 'string' ? real.trim() : '';
                      if (realValue && !mapping[realValue] && !this.shouldSkipPseudoEntity(realValue, 'resource')) {
                        mapping[realValue] = typeof fake === 'string' && fake.trim().length > 0
                          ? fake.trim()
                          : this.createPseudoReplacement('resource', counters);
                        added++;
                      }
                    }
                  }
                } catch (e) {
                  this.appendTerminalOutput(`    ⚠ Could not parse AI mappings for ${files[i].relativePath}`, 'error');
                }
              }

              // Keep AI-assisted document mode gentle on local model servers.
              await new Promise(r => setTimeout(r, 750));
            }
          }

          totalAdded += added;
          if (added > 0) {
            this.appendTerminalOutput(`    + ${added} entities`, 'output');
          }

          if (totalFiles % 100 === 0) {
            await window.vomit.pseudoSaveMapping(cwd, mapping);
          }
        }
      }

      if (totalFiles === 0) {
        this.appendTerminalOutput('\nNo supported text files found to pseudonymize.', 'error');
        this.appendTerminalOutput('Supported examples: .md, .markdown, .txt, .adoc, .rst, .yaml, .json, .tf, .xml, .sql, and common source/config files.', 'system');
        this.appendTerminalOutput('Binary formats like .docx, .pdf, .xlsx, and .pptx are skipped.', 'system');
        return;
      }

      const sanitizedFinal = this.sanitizePseudoMapping(mapping);
      mapping = sanitizedFinal.mapping;

      // Save final mapping
      await window.vomit.pseudoSaveMapping(cwd, mapping);
      this.appendTerminalOutput(`\n✓ Mapping complete: ${Object.keys(mapping).length} entities total (${totalAdded} new from ${totalFiles} files).`, 'output');

      // 3. Phase 2 — Apply mapping to create pseudo repos
      this.appendTerminalOutput('\n── Phase 2: Creating pseudo repos ──', 'system');

      const projectData = { repos: [], createdAt: new Date().toISOString() };

      for (const repo of repos) {
        const pseudoPath = `${cwd}/pseudo/${repo.name}`;

        // Clean existing pseudo repo for fresh rebuild
        await window.vomit.pseudoRemoveDir(pseudoPath);

        this.appendTerminalOutput(`\nCreating pseudo/${repo.name}/...`, 'system');

        // Copy file structure
        const fileCount = await window.vomit.pseudoCopyStructure(repo.path, pseudoPath);
        this.appendTerminalOutput(`  Copied ${fileCount} files.`, 'system');
        if (fileCount === 0) {
          this.appendTerminalOutput('  No copyable text files found; skipping git baseline for this target.', 'error');
          continue;
        }

        // Apply mapping to all files
        const pseudoFiles = await this.getFilesRecursively(pseudoPath, targetExtensions);
        let replacedCount = 0;

        // Sort mapping keys by length (longest first) to avoid partial replacements
        const sortedKeys = Object.keys(mapping).sort((a, b) => b.length - a.length);

        for (const file of pseudoFiles) {
          let content = await window.vomit.readFile(file.path);
          let changed = false;

          const applied = this.applyPseudoMappingToContent(content, sortedKeys, mapping);
          content = applied.content;
          changed = applied.changed;

          if (changed) {
            await window.vomit.writeFile(file.path, content);
            replacedCount++;
          }
        }

        this.appendTerminalOutput(`  Applied mapping to ${replacedCount} files.`, 'system');

        // Git init + commit baseline
        const gitResult = await window.vomit.pseudoGitInit(pseudoPath);
        if (gitResult.success) {
          projectData.repos.push({
            name: repo.name,
            sourcePath: repo.path,
            pseudoPath: pseudoPath,
            baselineHash: gitResult.baselineHash
          });
          this.appendTerminalOutput(`  ✓ Git baseline: ${gitResult.baselineHash.substring(0, 8)}`, 'output');
        } else {
          this.appendTerminalOutput(`  ⚠ Git init failed: ${gitResult.error}`, 'error');
          projectData.repos.push({
            name: repo.name,
            sourcePath: repo.path,
            pseudoPath: pseudoPath,
            baselineHash: null
          });
        }
      }

      // Save project metadata
      await window.vomit.pseudoSaveProject(cwd, projectData);

      this.appendTerminalOutput('\n══════════════════════════════════════', 'system');
      this.appendTerminalOutput('✓ Pseudonymization complete!', 'output');
      this.appendTerminalOutput(`  Mapping: mapping.json (${Object.keys(mapping).length} entities)`, 'system');
      for (const repo of projectData.repos) {
        this.appendTerminalOutput(`  Repo: pseudo/${repo.name}/`, 'system');
      }
      this.appendTerminalOutput('\nPoint your cloud agent at: pseudo/', 'system');
      this.appendTerminalOutput('When done: /pseudo-depseudo <repo-name> to merge back.', 'system');
      this.appendTerminalOutput('══════════════════════════════════════', 'system');

      this.fileTreeManager.loadFileTree();

    } catch (err) {
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
    }
  }

  async depseudoRepo(repoName, cwd) {
    this.appendTerminalOutput(`❯ /pseudo-depseudo ${repoName}`, 'input');

    try {
      // Load project metadata
      const project = await window.vomit.pseudoReadProject(cwd);
      if (!project) {
        this.appendTerminalOutput('Error: No pseudo project found in this bucket.', 'error');
        this.appendTerminalOutput('Run /pseudo-run first.', 'system');
        return;
      }

      // Find the repo
      const repoInfo = project.repos.find(r => r.name === repoName);
      if (!repoInfo) {
        const available = project.repos.map(r => r.name).join(', ');
        this.appendTerminalOutput(`Error: Repo "${repoName}" not found.`, 'error');
        this.appendTerminalOutput(`Available: ${available}`, 'system');
        return;
      }

      // Load mapping
      const mapping = await window.vomit.pseudoReadMapping(cwd);
      if (!mapping) {
        this.appendTerminalOutput('Error: No mapping found.', 'error');
        return;
      }

      this.appendTerminalOutput(`Checking changes in pseudo/${repoName}/...`, 'system');

      // Get changed files
      let changedFiles;
      if (repoInfo.baselineHash) {
        changedFiles = await window.vomit.pseudoGitChangedFiles(repoInfo.pseudoPath, repoInfo.baselineHash);
      } else {
        this.appendTerminalOutput('Warning: No git baseline — processing all files.', 'system');
        const targetExtensions = ['.tf', '.yaml', '.yml', '.json', '.md', '.env', '.sh', '.ps1', '.py', '.js', '.ts', '.tsx', '.jsx', '.go', '.hcl', '.bicep', '.toml', '.xml', '.sql'];
        const allFiles = await this.getFilesRecursively(repoInfo.pseudoPath, targetExtensions);
        changedFiles = allFiles.map(f => f.relativePath);
      }

      if (changedFiles.length === 0) {
        this.appendTerminalOutput('No changes detected in pseudo repo.', 'system');
        return;
      }

      this.appendTerminalOutput(`Found ${changedFiles.length} changed file(s).`, 'system');

      // Build reverse mapping (fake → real), sorted longest first
      const reverseMapping = {};
      for (const [real, fake] of Object.entries(mapping)) {
        reverseMapping[fake] = real;
      }
      const sortedFakes = Object.keys(reverseMapping).sort((a, b) => b.length - a.length);

      // Apply reverse mapping and write to real repo
      let applied = 0;
      for (const relPath of changedFiles) {
        const pseudoFilePath = `${repoInfo.pseudoPath}/${relPath}`;
        const realFilePath = `${repoInfo.sourcePath}/${relPath}`;

        try {
          let content = await window.vomit.readFile(pseudoFilePath);

          // Apply reverse mapping
          for (const fake of sortedFakes) {
            const real = reverseMapping[fake];
            content = this.replacePseudoToken(content, fake, real);
          }

          await window.vomit.writeFile(realFilePath, content);
          this.appendTerminalOutput(`  ✓ ${relPath}`, 'output');
          applied++;
        } catch (err) {
          this.appendTerminalOutput(`  ✗ ${relPath}: ${err.message}`, 'error');
        }
      }

      this.appendTerminalOutput(`\n✓ Applied ${applied} file(s) to ${repoName}/`, 'output');
      this.appendTerminalOutput(`Review with: cd ${repoInfo.sourcePath} && git diff`, 'system');
      this.fileTreeManager.loadFileTree();

    } catch (err) {
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
    }
  }

  async showPseudoMapping(cwd) {
    this.appendTerminalOutput('❯ /pseudo-map', 'input');

    const mapping = await window.vomit.pseudoReadMapping(cwd);
    if (!mapping) {
      this.appendTerminalOutput('No mapping found. Run /pseudo-run first.', 'system');
      return;
    }

    const entries = Object.entries(mapping);
    this.appendTerminalOutput(`Mapping (${entries.length} entities):`, 'system');
    for (const [real, fake] of entries) {
      this.appendTerminalOutput(`  ${real} → ${fake}`, 'output');
    }
  }

  async indexFolderForRAG(projectRoot, targetPath, subpath) {
    const displayPath = subpath ? `/index ${subpath}` : '/index';
    this.appendTerminalOutput(`❯ ${displayPath}`, 'input');
    this.appendTerminalOutput(
      subpath
        ? `Refreshing ${subpath} in the bucket RAG index...`
        : 'Indexing current bucket for RAG...',
      'system'
    );
    this.appendTerminalOutput('Embeddings need nomic-embed-text: via Ollama (ollama pull nomic-embed-text) or the active OpenAI-compatible endpoint (e.g. LM Studio)', 'system');

    try {
      const result = await window.vomit.ragIndex(projectRoot, targetPath);
      if (result.success) {
        this.appendTerminalOutput(`✓ Bucket index updated! ${result.indexed} chunks from ${result.files} files.`, 'output');
        this.appendTerminalOutput('Use /rag <query> to search the current bucket with context.', 'system');
      } else {
        this.appendTerminalOutput(`✗ Indexing failed: ${result.error}`, 'error');
      }
    } catch (err) {
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
    }
  }

  async reindexRAG(cwd) {
    this.appendTerminalOutput('❯ /reindex', 'input');
    this.appendTerminalOutput('Clearing current bucket RAG index...', 'system');

    try {
      const clearResult = await window.vomit.ragClear(cwd);
      if (!clearResult.success) {
        this.appendTerminalOutput(`✗ Cleanup failed: ${clearResult.error}`, 'error');
        return;
      }

      const removed = clearResult.deleted > 0
        ? `Removed ${clearResult.deleted} database file${clearResult.deleted === 1 ? '' : 's'}.`
        : 'No existing RAG database found.';
      this.appendTerminalOutput(removed, 'system');
      this.appendTerminalOutput('Rebuilding full bucket index...', 'system');
      this.appendTerminalOutput('Embeddings need nomic-embed-text: via Ollama (ollama pull nomic-embed-text) or the active OpenAI-compatible endpoint (e.g. LM Studio)', 'system');

      const result = await window.vomit.ragIndex(cwd, cwd);
      if (result.success) {
        this.appendTerminalOutput(`✓ Reindex complete! ${result.indexed} chunks from ${result.files} files.`, 'output');
        this.appendTerminalOutput('Use /rag <query> to search the current bucket with fresh context.', 'system');
      } else {
        this.appendTerminalOutput(`✗ Reindex failed: ${result.error}`, 'error');
      }
    } catch (err) {
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
    }
  }

  // Show a RAG source path relative to the bucket root when possible, else
  // just the file name — keeps the sources list and citations readable.
  _ragDisplayPath(file, root) {
    if (!file) return '';
    if (root && window.PathUtils.isSubPath(file, root)) {
      const rel = window.PathUtils.relativeParts(file, root).join('/');
      if (rel) return rel;
    }
    return window.PathUtils.basename(file);
  }

  async searchWithRAG(query, cwd) {
    this.appendTerminalOutput(`❯ /rag ${query}`, 'input');

    try {
      // Search the index for relevant context
      const results = await window.vomit.ragSearch(query, cwd);

      if (!results.success) {
        if (results.error === 'not_indexed') {
          this.appendTerminalOutput('No bucket index found. Run /index first to index the current bucket.', 'error');
        } else {
          this.appendTerminalOutput(`Search failed: ${results.error}`, 'error');
        }
        return;
      }

      if (results.chunks.length === 0) {
        this.appendTerminalOutput('No relevant context found. Try a different query.', 'system');
        return;
      }

      // Summarize which documents the answer draws on (best similarity per
      // file), so the user can see and verify the sources. RAG results carry
      // bucket-relative paths — resolve them against the bucket root so the
      // links point at real files.
      const fileStats = new Map();
      for (const chunk of results.chunks) {
        const file = window.PathUtils.join(cwd, chunk.file);
        const stat = fileStats.get(file) || { file, best: 0, count: 0, source: chunk.source };
        stat.best = Math.max(stat.best, chunk.similarity || 0);
        stat.count += 1;
        if (chunk.source === 'wikilink') stat.source = 'wikilink';
        fileStats.set(file, stat);
      }
      const sources = [...fileStats.values()].sort((a, b) => b.best - a.best);

      this.appendTerminalOutput(`Found ${results.chunks.length} relevant chunks across ${sources.length} document(s):`, 'system');
      for (const s of sources) {
        const rel = this._ragDisplayPath(s.file, cwd);
        const pct = Math.round((s.best || 0) * 100);
        const chunkNote = s.count > 1 ? `, ${s.count} chunks` : '';
        const via = s.source === 'wikilink' ? ' (via wikilink)' : '';
        this._appendTerminalDocLink(s.file, rel, ` (${pct}% match${chunkNote})${via}`);
      }
      this.appendTerminalOutput('Querying AI...', 'system');

      // Remember the source documents so markOutputComplete can turn the
      // answer's "(source: notes.md)" citations into clickable links.
      this._ragLinkTargets = sources.map((s) => ({
        file: s.file,
        labels: [...new Set([
          this._ragDisplayPath(s.file, cwd),
          window.PathUtils.basename(s.file),
        ])].filter(Boolean),
      }));

      const contextParts = results.chunks.map((chunk) => {
        const tag = chunk.source === 'wikilink' ? ' (via wikilink)' : '';
        return `[Source: ${this._ragDisplayPath(window.PathUtils.join(cwd, chunk.file), cwd)}${tag}]\n${chunk.content}`;
      });
      const context = contextParts.join('\n\n---\n\n');

      const ragPrompt = `You are a helpful assistant. Answer the user's question based on the following context from their bucket files.

Context from bucket:
---
${context}
---

User question: ${query}

Provide a helpful, accurate answer based on the context above. Cite the source documents you used by their file name (e.g. "(source: notes.md)") next to the relevant points, and end with a short "Sources:" list of the documents you drew from. If the context doesn't contain relevant information, say so.`;

      this.state.isClaudeRunning = true;
      this.terminalStop.classList.remove('hidden');
      this.showThinkingIndicator();

      await window.vomit.agentExecute(ragPrompt, cwd);
    } catch (err) {
      this._ragLinkTargets = null;
      this.hideThinkingIndicator();
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
    }
  }

  // Append a terminal line whose document name is a clickable link that
  // opens the file in the editor.
  _appendTerminalDocLink(file, label, suffix = '') {
    const line = document.createElement('div');
    line.className = 'terminal-line output';
    line.appendChild(document.createTextNode('  • '));
    const link = document.createElement('a');
    link.className = 'terminal-doc-link';
    link.href = '#';
    link.dataset.file = file;
    link.textContent = label;
    line.appendChild(link);
    if (suffix) line.appendChild(document.createTextNode(suffix));
    this.terminalOutput.appendChild(line);
    if (this.pickerState.active && this.pickerState.blockEl) {
      this.terminalOutput.appendChild(this.pickerState.blockEl);
    }
    this.terminalOutput.scrollTop = this.terminalOutput.scrollHeight;
  }

  // Wrap mentions of RAG source documents in the rendered answer (e.g.
  // "(source: notes.md)") with links that open the document in the editor.
  // Skips code blocks and existing links; longest labels match first so
  // "notes/foo.md" wins over "foo.md".
  _linkifyRagSources(root) {
    const targets = [];
    for (const t of this._ragLinkTargets || []) {
      for (const label of t.labels) targets.push({ label, file: t.file });
    }
    if (!targets.length) return;
    targets.sort((a, b) => b.label.length - a.label.length);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.closest('pre, code, a')) continue;
      textNodes.push(node);
    }

    for (const textNode of textNodes) {
      const text = textNode.nodeValue;
      let cursor = 0;
      const frag = document.createDocumentFragment();
      while (cursor < text.length) {
        let best = null;
        for (const t of targets) {
          const idx = text.indexOf(t.label, cursor);
          if (idx !== -1 && (best === null || idx < best.idx)) best = { idx, target: t };
        }
        if (!best) break;
        frag.appendChild(document.createTextNode(text.slice(cursor, best.idx)));
        const link = document.createElement('a');
        link.className = 'terminal-doc-link';
        link.href = '#';
        link.dataset.file = best.target.file;
        link.textContent = best.target.label;
        frag.appendChild(link);
        cursor = best.idx + best.target.label.length;
      }
      if (!frag.childNodes.length) continue;
      frag.appendChild(document.createTextNode(text.slice(cursor)));
      textNode.replaceWith(frag);
    }
  }

  async reindexWiki(cwd) {
    this.appendTerminalOutput('❯ /wiki reindex', 'input');
    this.appendTerminalOutput('Rebuilding wikilink index for current bucket...', 'system');
    try {
      const result = await window.vomit.wikiIndex(cwd);
      if (result.success) {
        const broken = result.brokenLinks > 0
          ? ` (${result.brokenLinks} broken)`
          : '';
        this.appendTerminalOutput(
          `✓ Wiki index built: ${result.linksIndexed} links across ${result.filesProcessed} notes${broken}.`,
          'output'
        );
      } else {
        this.appendTerminalOutput(`✗ Wiki index failed: ${result.error}`, 'error');
      }
    } catch (err) {
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
    }
  }

  async getFilesRecursively(dir, extensions) {
    const files = [];
    const skipDirs = this.getPseudoSkipDirs ? this.getPseudoSkipDirs() : new Set(['node_modules', 'pseudo']);

    const scan = async (currentDir, relativePath = '') => {
      const items = await window.vomit.getDirectoryContents(currentDir);

      for (const item of items) {
        const itemRelativePath = relativePath ? `${relativePath}/${item.name}` : item.name;

        if (item.isDirectory) {
          if (item.name.startsWith('.') || skipDirs.has(item.name)) continue;
          await scan(item.path, itemRelativePath);
        } else {
          if (item.name.startsWith('.') && item.name !== '.env') continue;
          const ext = item.name === '.env' ? '.env' : '.' + item.name.split('.').pop().toLowerCase();
          if (extensions.includes(ext)) {
            files.push({ path: item.path, relativePath: itemRelativePath });
          }
        }
      }
    };

    await scan(dir);
    return files;
  }

  waitForAIComplete() {
    return new Promise((resolve) => {
      const checkComplete = () => {
        if (!this.state.isClaudeRunning) {
          this.state.pseudoCollecting = false;
          resolve();
        } else {
          setTimeout(checkComplete, 100);
        }
      };
      checkComplete();
    });
  }

  // --- Output formatting ---

  normalizeTerminalText(value) {
    if (typeof value === 'string') return value;
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(v => this.normalizeTerminalText(v)).join('');
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

  appendTerminalOutput(text, type = 'output') {
    text = this.normalizeTerminalText(text);
    // Hide thinking indicator when first output arrives
    if (type === 'output') {
      this.hideThinkingIndicator();
    }

    // For streaming output, append to a single div element (not pre, to allow nested code blocks)
    if (type === 'output') {
      let outputDiv = this.terminalOutput.querySelector('.terminal-output-stream:not(.complete)');
      if (!outputDiv) {
        outputDiv = document.createElement('div');
        outputDiv.className = 'terminal-line terminal-output-stream output';
        this.terminalOutput.appendChild(outputDiv);
      }
      outputDiv.textContent += text;
      if (this.pickerState.active && this.pickerState.blockEl) {
        this.terminalOutput.appendChild(this.pickerState.blockEl);
      }
      this.terminalOutput.scrollTop = this.terminalOutput.scrollHeight;
      return;
    }

    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.textContent = text;
    this.terminalOutput.appendChild(line);
    if (this.pickerState.active && this.pickerState.blockEl) {
      this.terminalOutput.appendChild(this.pickerState.blockEl);
    }
    this.terminalOutput.scrollTop = this.terminalOutput.scrollHeight;
  }

  showThinkingIndicator() {
    // Remove any existing indicator first
    this.hideThinkingIndicator();

    const indicator = document.createElement('div');
    indicator.className = 'terminal-line terminal-thinking-indicator';
    indicator.innerHTML = '<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span><span class="thinking-elapsed"></span>';
    this.terminalOutput.appendChild(indicator);
    this.terminalOutput.scrollTop = this.terminalOutput.scrollHeight;

    // Local models can be silent for minutes during prompt evaluation —
    // an elapsed counter shows time is passing, not just pixels animating.
    const startedAt = Date.now();
    this._thinkingTimer = setInterval(() => {
      const el = this.terminalOutput.querySelector('.terminal-thinking-indicator .thinking-elapsed');
      if (!el) return;
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      if (seconds >= 3) el.textContent = ` ${seconds}s`;
    }, 1000);
  }

  hideThinkingIndicator() {
    if (this._thinkingTimer) {
      clearInterval(this._thinkingTimer);
      this._thinkingTimer = null;
    }
    const indicator = this.terminalOutput.querySelector('.terminal-thinking-indicator');
    if (indicator) {
      indicator.remove();
    }
  }

  // Format LLM performance metrics into a compact one-line summary for
  // comparing backends/models (e.g. Ollama vs MLX). Returns '' if empty.
  _formatMetrics(m) {
    if (!m) return '';
    const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
    const parts = [];
    if (m.model) parts.push(`${m.model}${m.provider ? ` (${m.provider})` : ''}`);
    if (m.genTokens != null) parts.push(`${m.genTokens} tok`);
    // Headline rate is overall throughput (gen tokens / total time) — the same
    // measurement for every backend, so it's comparable.
    if (m.tokensPerSec != null) parts.push(`${m.estimated ? '~' : ''}${m.tokensPerSec.toFixed(1)} tok/s`);
    // Extras only available when the backend reports them (Ollama).
    if (m.decodeTps != null) parts.push(`${m.decodeTps.toFixed(0)} tok/s decode`);
    if (m.ttftMs != null) parts.push(`TTFT ${fmtMs(m.ttftMs)}`);
    if (m.totalMs != null) parts.push(fmtMs(m.totalMs));
    if (!parts.length) return '';
    return `⚡ ${parts.join(' · ')}`;
  }

  markOutputComplete() {
    this.hideThinkingIndicator();
    const outputStream = this.terminalOutput.querySelector('.terminal-output-stream:not(.complete)');
    if (outputStream) {
      outputStream.classList.add('complete');

      // Render as markdown
      this.renderMarkdown(outputStream);

      // If this was a /rag answer, make its source citations clickable
      if (this._ragLinkTargets) {
        this._linkifyRagSources(outputStream);
      }
    }
    this._ragLinkTargets = null;
  }

  // Normalize LaTeX delimiters from LLM output.
  // Many models output [ ... ] instead of \[ ... \] for display math.
  normalizeLatexDelimiters(text) {
    return text.replace(/\[\s*((?:[^[\]]*\\(?:text|frac|times|approx|sqrt|sum|prod|int|cdot)[^[\]]*)+)\s*\]/g, '\\[$1\\]');
  }

  renderMarkdown(element) {
    const text = this.normalizeLatexDelimiters(element.textContent);

    if (!text.trim()) {
      return;
    }

    // Configure marked to use highlight.js for code blocks
    if (window.marked && window.hljs) {
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
            const highlighted = window.hljs.highlight(code, { language: lang, ignoreIllegals: true });
            return `<pre class="terminal-code"><code class="hljs language-${escapeHtml(lang)}">${highlighted.value}</code></pre>`;
          } catch (e) {
            // Fallback to auto-detection
          }
        }
        // Auto-detect language
        try {
          const highlighted = window.hljs.highlightAuto(code);
          return `<pre class="terminal-code"><code class="hljs">${highlighted.value}</code></pre>`;
        } catch (e) {
          return `<pre class="terminal-code"><code>${escapeHtml(code)}</code></pre>`;
        }
      };

      // Custom inline code renderer
      renderer.codespan = function(tokenOrCode) {
        const code = typeof tokenOrCode === 'object' && tokenOrCode !== null
          ? tokenOrCode.text || ''
          : String(tokenOrCode || '');
        return `<code class="terminal-inline-code">${escapeHtml(code)}</code>`;
      };

      // Helper function for escaping HTML (needs to be accessible in renderer scope)
      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      // Render the markdown
      try {
        const html = marked.parse(text, {
          renderer,
          breaks: false,
          gfm: true,
          headerIds: false,
          mangle: false,
          sanitize: false
        });
        element.innerHTML = html;

        // Render LaTeX math formulas with KaTeX
        if (window.renderMathInElement) {
          window.renderMathInElement(element, {
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
        // Fallback to plain text
        element.textContent = text;
      }
    } else {
      // Fallback: just show plain text if marked is not available
      element.textContent = text;
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  clearTerminal() {
    this._closePicker();
    this.terminalOutput.innerHTML = '';
  }

  stopAI() {
    window.vomit.claudeStop();
    this.state.pseudoCollecting = false;
    this.appendTerminalOutput('^C', 'system');
  }

  updateTerminalTitle(aiInfo) {
    const titleEl = this.terminalPanel.querySelector('.terminal-title');
    if (titleEl) {
      if (aiInfo.provider === 'ollama') {
        titleEl.textContent = `Ollama: ${aiInfo.model}`;
      } else if (aiInfo.provider === 'openai-compatible') {
        titleEl.textContent = `OpenAI-Compatible: ${aiInfo.model || '(no model)'}`;
      } else {
        titleEl.textContent = 'AI Terminal';
      }
    }
  }

  async initTerminalTitle() {
    if (window.vomit && window.vomit.getAIProvider) {
      const aiInfo = await window.vomit.getAIProvider();
      this.updateTerminalTitle(aiInfo);
    }
  }

  async updateContextBar() {
    if (!this.terminalContextBar) return;
    try {
      const stats = await window.vomit.getContextStats();
      if (!stats || stats.model === 'none' || stats.messageCount === 0) {
        this.terminalContextBar.classList.remove('visible', 'level-ok', 'level-warn', 'level-danger');
        return;
      }

      const pct = stats.usagePercent;
      const level = pct >= 75 ? 'danger' : pct >= 50 ? 'warn' : 'ok';
      const tokensK = (stats.estimatedTokens / 1000).toFixed(1);
      const limitK = (stats.contextLimit / 1000).toFixed(0);

      this.terminalContextBar.classList.add('visible');
      this.terminalContextBar.classList.remove('level-ok', 'level-warn', 'level-danger');
      this.terminalContextBar.classList.add(`level-${level}`);

      let hint = '';
      if (pct >= 75) hint = ' — consider /new to clear';
      else if (pct >= 50) hint = ' — getting full';

      this.terminalContextBar.innerHTML =
        `<span>${stats.model}</span>` +
        `<span>${stats.messageCount} messages · ~${tokensK}K/${limitK}K tokens</span>` +
        `<span class="context-usage"><span class="context-usage-fill" style="width:${Math.min(pct, 100)}%"></span></span>` +
        `<span>${pct}%${hint}</span>`;
    } catch (e) {
      // Silently fail — stats are informational only
    }
  }

  // --- Terminal detach/reattach ---

  detachTerminal() {
    // Save current terminal height before detaching
    this.state.terminalHeight = this.terminalPanel.offsetHeight;

    // Get the current terminal output HTML to transfer to detached window
    const terminalOutputHTML = this.terminalOutput.innerHTML;

    // Pass the renderer's file/project context — main's SessionState doesn't
    // track projectRoot/currentDirectory, so the detached terminal would
    // otherwise not know which doc/folder is open and slash-commands like
    // /doc or /agent would fail the "No project folder open" guard.
    window.vomit.detachTerminal({
      terminalHTML: terminalOutputHTML,
      currentFilePath: this.state.currentFilePath,
      basePath: this.state.basePath,
      projectRoot: this.state.projectRoot,
      currentDirectory: this.state.currentDirectory
    });
  }

  // Sync file/project context to the detached terminal whenever it changes in
  // the main window (tab switch, file open, bucket switch).
  _syncDetachedContext() {
    if (!this.state.isTerminalDetached) return;
    window.vomit.syncTerminalContext({
      currentFilePath: this.state.currentFilePath,
      basePath: this.state.basePath,
      projectRoot: this.state.projectRoot,
      currentDirectory: this.state.currentDirectory
    });
  }

  _setupDetachedContextSync() {
    const sync = () => this._syncDetachedContext();
    this.state.addEventListener('change:currentFilePath', sync);
    this.state.addEventListener('change:basePath', sync);
    this.state.addEventListener('change:projectRoot', sync);
    this.state.addEventListener('change:currentDirectory', sync);
  }

  onTerminalDetached() {
    this.state.isTerminalDetached = true;
    this.state.isTerminalPanelVisible = false;
    this.terminalPanel.classList.add('hidden');

    // Update detach button to show reattach state
    this.terminalDetach.textContent = '↩';
    this.terminalDetach.title = 'Reattach terminal';

    // Clear inline padding style
    const mainContainer = document.getElementById('main-container');
    if (mainContainer) mainContainer.style.paddingBottom = '';
    this.host.focus();
  }

  onTerminalReattached() {
    this.state.isTerminalDetached = false;
    this.state.isTerminalPanelVisible = true;
    this.terminalPanel.classList.remove('hidden');

    // Update detach button back to detach state
    this.terminalDetach.textContent = '⧉';
    this.terminalDetach.title = 'Detach terminal';

    // Restore terminal height
    if (this.state.terminalHeight) {
      this.terminalPanel.style.height = `${this.state.terminalHeight}px`;
    }

    // Set padding to match restored terminal height
    const mainContainer = document.getElementById('main-container');
    if (mainContainer) {
      mainContainer.style.paddingBottom = `${this.terminalPanel.offsetHeight}px`;
    }

    this.terminalInput.focus();
  }
}

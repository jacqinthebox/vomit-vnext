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
    this.terminalTabs = dom.terminalTabs;
    this.aiTerminalContent = dom.aiTerminalContent;
    this.terminalOutput = dom.terminalOutput;
    this.terminalInput = dom.terminalInput;
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

    // Command autocomplete state
    this.commandPopup = null;

    // Write mode state (for streaming to editor)
    this.writeMode = null; // null, 'cursor', 'new', 'replace', 'append'
    this.writeBuffer = '';
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
      const cleanOutput = e.detail.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

      if (this.state.pseudoCollecting) {
        this.state.pseudoOutput += cleanOutput;
      } else if (this.writeMode) {
        // In write mode, stream to editor AND show in terminal
        this.writeBuffer += cleanOutput;
        this.streamToEditor(cleanOutput);
        this.appendTerminalOutput(e.detail, 'output');
      } else {
        this.appendTerminalOutput(e.detail, 'output');
      }
    });

    window.addEventListener('vomit:claude-error', (e) => {
      this.appendTerminalOutput(e.detail, 'error');
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
  }

  // --- Terminal setup and UI ---

  setupTerminal() {
    if (!this.terminalInput) return;

    // Handle input changes - show command popup when typing /
    this.terminalInput.addEventListener('input', () => {
      const value = this.terminalInput.value;
      if (value.startsWith('/')) {
        this.showCommandPopup(value);
      } else {
        this.hideCommandPopup();
      }
    });

    // Handle input submission
    this.terminalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.hideCommandPopup();
        const command = this.terminalInput.value.trim();
        if (command) {
          this.executeClaudeCommand(command);
          this.state.terminalHistory.push(command);
          this.state.terminalHistoryIndex = this.state.terminalHistory.length;
          this.terminalInput.value = '';
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.state.terminalHistoryIndex > 0) {
          this.state.terminalHistoryIndex--;
          this.terminalInput.value = this.state.terminalHistory[this.state.terminalHistoryIndex] || '';
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.state.terminalHistoryIndex < this.state.terminalHistory.length - 1) {
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
        if (this.commandPopup && !this.commandPopup.classList.contains('hidden')) {
          this.hideCommandPopup();
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
        this.appendTerminalOutput('Conversation cleared.', 'system');
      }
    });

    // Clear button - clears active terminal
    this.terminalClear.addEventListener('click', () => {
      if (this.state.activeTerminalTab === 'ai') {
        this.clearTerminal();
        window.vomit.claudeClearHistory();
        this.appendTerminalOutput('Conversation cleared.', 'system');
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
      this.appendTerminalOutput(`  ${c.name}${args}  —  ${c.description}`, 'output');
    });
    this.appendTerminalOutput('', 'system');
  }

  showCommandPopup(filter = '/') {
    const { COMMAND_REGISTRY } = window.TerminalCommands;

    // Create popup if it doesn't exist
    if (!this.commandPopup) {
      this.commandPopup = document.createElement('div');
      this.commandPopup.className = 'command-popup hidden';
      // Insert popup before the input container
      const inputContainer = document.getElementById('terminal-input-container');
      inputContainer.style.position = 'relative';
      inputContainer.insertBefore(this.commandPopup, inputContainer.firstChild);
    }

    // Filter commands based on input
    const filterText = filter.substring(1).toLowerCase(); // Remove leading /
    const filtered = filterText
      ? COMMAND_REGISTRY.filter(c => c.name.toLowerCase().includes(filterText))
      : COMMAND_REGISTRY;

    if (filtered.length === 0) {
      this.hideCommandPopup();
      return;
    }

    // Build popup content
    this.commandPopup.innerHTML = filtered.map(c => {
      const args = c.argsHint ? c.argsHint : '';
      return `<div class="command-item" data-cmd="${c.name}">
        <span class="command-name">${c.name}</span>
        <span class="command-args">${args}</span>
        <span class="command-desc">${c.description}</span>
      </div>`;
    }).join('');

    // Add click handlers
    this.commandPopup.querySelectorAll('.command-item').forEach(item => {
      item.addEventListener('click', () => {
        const cmd = item.dataset.cmd;
        this.terminalInput.value = cmd + ' ';
        this.terminalInput.focus();
        this.hideCommandPopup();
      });
    });

    this.commandPopup.classList.remove('hidden');
  }

  hideCommandPopup() {
    if (this.commandPopup) {
      this.commandPopup.classList.add('hidden');
    }
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
      const newHeight = Math.max(100, Math.min(600, startHeight + delta));
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
    // /help is handled before dispatch: it needs no cwd and is not in the registry
    // so it does not appear in the command popup.
    if (command.trim() === '/help') {
      this.appendTerminalOutput('❯ /help', 'input');
      this.showAvailableCommands();
      return;
    }

    const { parseCommand, dispatchCommand } = window.TerminalCommands;
    const parsed = parseCommand(command);
    if (parsed) {
      try {
        await dispatchCommand(parsed, this);
      } catch (err) {
        this.appendTerminalOutput(`Error: ${err.message}`, 'error');
        this.state.isClaudeRunning = false;
        this.terminalStop.classList.add('hidden');
      }
      return;
    }

    // Plain text or unrecognized slash command — pass directly to AI
    const cwd = this.state.projectRoot || this.state.currentDirectory;
    if (!cwd) {
      this.appendTerminalOutput('Error: No project folder open. Open a folder first with Cmd+Alt+O.', 'error');
      return;
    }

    this.appendTerminalOutput(`❯ ${command}`, 'input');
    this.state.isClaudeRunning = true;
    this.terminalStop.classList.remove('hidden');

    try {
      await window.vomit.claudeExecute(command, cwd);
    } catch (err) {
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

    try {
      await window.vomit.agentExecute(prompt, cwd);
    } catch (err) {
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
          this.host.cm.replaceSelection(presentation);
          this.appendTerminalOutput('✓ Presentation inserted at cursor', 'output');
        }
      }
      this.markOutputComplete();
    } catch (err) {
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
      this.state.isClaudeRunning = false;
      this.terminalStop.classList.add('hidden');
    }
  }

  // --- Write commands (stream AI output to editor) ---

  async executeWriteCommand(prompt, mode, cwd) {
    const modeLabels = {
      cursor: 'insert at cursor',
      new: 'create new file',
      replace: 'replace selection',
      append: 'append to document'
    };

    const cmdName = mode === 'new' ? '/write-new' :
                    mode === 'replace' ? '/rewrite' :
                    mode === 'append' ? '/append' : '/write';

    this.appendTerminalOutput(`❯ ${cmdName} ${prompt}`, 'input');
    this.appendTerminalOutput(`Writing to editor (${modeLabels[mode]})...`, 'system');

    // For replace mode, check if there's a selection
    if (mode === 'replace') {
      const selection = this.host.getSelection();
      if (!selection) {
        this.appendTerminalOutput('Error: No text selected. Select text first.', 'error');
        return;
      }
    }

    // Set up write mode
    this.writeMode = mode;
    this.writeBuffer = '';
    this.writeStartCursor = null;

    // For new file, create the file first
    if (mode === 'new') {
      // Trigger new file creation, wait for it to be ready
      window.vomit.newFile();
      // Wait a bit for the file to be created and loaded
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Remember cursor position for streaming
    if (mode === 'cursor') {
      this.writeStartCursor = this.host.getCursor();
    } else if (mode === 'replace') {
      // Get selection range
      const cm = this.host.raw;
      this.writeSelectionStart = cm.getCursor('from');
      this.writeSelectionEnd = cm.getCursor('to');
      // Delete the selection first
      this.host.replaceSelection('');
      this.writeStartCursor = this.host.getCursor();
    } else if (mode === 'append') {
      // Move cursor to end of document
      const cm = this.host.raw;
      const lastLine = cm.lastLine();
      const lastLineLength = cm.getLine(lastLine).length;
      cm.setCursor({ line: lastLine, ch: lastLineLength });
      // Add newlines before appending
      this.host.replaceSelection('\n\n');
      this.writeStartCursor = this.host.getCursor();
    }

    // Build the prompt with context if needed
    let finalPrompt = prompt;
    if (mode === 'replace') {
      // Include the selected text for context
      finalPrompt = `Rewrite/improve the following text based on this instruction: "${prompt}"\n\nOriginal text:\n${this.host.getSelection() || ''}\n\nProvide ONLY the rewritten text, no explanations.`;
    } else if (mode !== 'new') {
      // For cursor/append, provide document context
      const docContent = this.host.getContent();
      if (docContent.trim()) {
        finalPrompt = `Context - current document:\n---\n${docContent}\n---\n\nTask: ${prompt}\n\nProvide ONLY the content to insert, no explanations or markdown code blocks.`;
      }
    }

    this.state.isClaudeRunning = true;
    this.terminalStop.classList.remove('hidden');

    try {
      await window.vomit.claudeExecute(finalPrompt, cwd);
    } catch (err) {
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
      this.writeMode = null;
      this.state.isClaudeRunning = false;
      this.terminalStop.classList.add('hidden');
    }
  }

  streamToEditor(text) {
    if (!this.writeMode) return;

    // Insert the new text at current cursor position
    this.host.replaceSelection(text);
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
    }

    this.writeBuffer = '';
    this.writeStartCursor = null;

    // Focus the editor
    this.host.focus();
  }

  async pseudonymizeCurrentDoc(cwd) {
    this.appendTerminalOutput('❯ /pseudo', 'input');
    this.appendTerminalOutput('Pseudonymizing current document...', 'system');

    const docContent = this.host.getContent();
    if (!docContent.trim()) {
      this.appendTerminalOutput('Error: Document is empty.', 'error');
      return;
    }

    // Determine output file paths
    const currentFile = this.state.currentFilePath;
    let outputPath;
    let mappingPath;
    if (currentFile) {
      const dir = currentFile.substring(0, currentFile.lastIndexOf('/'));
      const filename = currentFile.split('/').pop();
      const ext = filename.lastIndexOf('.') > 0 ? filename.substring(filename.lastIndexOf('.')) : '';
      const basename = filename.lastIndexOf('.') > 0 ? filename.substring(0, filename.lastIndexOf('.')) : filename;
      outputPath = `${dir}/${basename}-pseudo${ext}`;
      mappingPath = `${dir}/${basename}-pseudo.map.json`;
    } else {
      outputPath = `${cwd}/untitled-pseudo.md`;
      mappingPath = `${cwd}/untitled-pseudo.map.json`;
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
          // Apply mapping to original content programmatically
          let content = docContent;
          for (const [original, replacement] of Object.entries(mapping)) {
            const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Case-insensitive replacement that preserves original case pattern
            content = content.replace(new RegExp(escaped, 'gi'), (match) => {
              // Determine case pattern of matched text and apply to replacement
              if (match === match.toUpperCase()) {
                return replacement.toUpperCase();
              } else if (match === match.toLowerCase()) {
                return replacement.toLowerCase();
              } else if (match[0] === match[0].toUpperCase()) {
                // Title case - capitalize first letter of replacement
                return replacement.charAt(0).toUpperCase() + replacement.slice(1);
              }
              return replacement;
            });
          }

          // Save the pseudonymized content
          await window.vomit.writeFile(outputPath, content);
          this.appendTerminalOutput(`✓ Saved: ${outputPath.split('/').pop()}`, 'output');

          // Save the mapping
          await window.vomit.writeFile(mappingPath, JSON.stringify(mapping, null, 2));
          this.appendTerminalOutput(`✓ Mapping saved: ${mappingPath.split('/').pop()}`, 'output');

          // Refresh the parent folder in the file tree
          const parentDir = outputPath.substring(0, outputPath.lastIndexOf('/'));
          await this.fileTreeManager.refreshFolder(parentDir);
        } else {
          this.appendTerminalOutput('No sensitive data found to anonymize.', 'system');
        }
      }
      this.markOutputComplete();
    } catch (err) {
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
      this.state.isClaudeRunning = false;
      this.terminalStop.classList.add('hidden');
    }
  }

  async depseudonymizeCurrentDoc() {
    this.appendTerminalOutput('❯ /depseudo', 'input');

    const currentFile = this.state.currentFilePath;
    if (!currentFile) {
      this.appendTerminalOutput('Error: No file open. Open a file first.', 'error');
      return;
    }

    // Determine mapping file path and original file path
    const dir = currentFile.substring(0, currentFile.lastIndexOf('/'));
    const filename = currentFile.split('/').pop();
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
      this.appendTerminalOutput('Open a *-pseudo.md file to run /depseudo.', 'system');
      return;
    }

    try {
      // Read the mapping file
      const mappingContent = await window.vomit.readFile(mappingPath);

      if (!mappingContent) {
        this.appendTerminalOutput(`Error: No mapping found at ${mappingPath.split('/').pop()}`, 'error');
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
        const regex = new RegExp(fake.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const matches = content.match(regex);
        if (matches) {
          replacements += matches.length;
          content = content.replace(regex, original);
        }
      }

      // Write to the ORIGINAL file
      await window.vomit.writeFile(originalPath, content);
      this.appendTerminalOutput(`✓ Restored ${replacements} values.`, 'output');
      this.appendTerminalOutput(`✓ Updated: ${originalPath.split('/').pop()}`, 'output');

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

  async runPseudonymization(cwd) {
    this.appendTerminalOutput('❯ /pseudo all', 'input');
    this.appendTerminalOutput('Starting batch pseudonymization...', 'system');

    // File extensions to process
    const targetExtensions = ['.tf', '.yaml', '.yml', '.json', '.md', '.env', '.sh', '.ps1', '.py', '.js', '.ts'];

    try {
      // Get all files recursively
      const files = await this.getFilesRecursively(cwd, targetExtensions);

      if (files.length === 0) {
        this.appendTerminalOutput('No files found to pseudonymize.', 'system');
        return;
      }

      this.appendTerminalOutput(`Found ${files.length} files to process.`, 'system');

      // Create output directory
      const outputDir = `${cwd}/pseudonymized`;
      await window.vomit.createDirectory(outputDir);

      const pseudoPrompt = `You are a pseudonymization tool. Replace ALL sensitive and identifying data in this file with realistic fake data:

- Person names → John Doe, Jane Smith, etc.
- Company/organization names → Acme Corp, Example Inc, etc.
- Email addresses → fake@example.com format
- Phone numbers → +1-555-XXX-XXXX format
- IP addresses → 10.0.0.x or 192.168.x.x ranges
- Server names/hostnames → server-001, app-server-prod, etc.
- FQDNs → *.example.com or *.internal.local
- URLs → https://example.com/...
- API keys/secrets → FAKE_API_KEY_XXXXX
- Passwords → FAKE_PASSWORD_XXXXX
- AWS/Azure/GCP resource IDs → fake resource IDs
- GUIDs/UUIDs → 00000000-0000-0000-0000-00000000XXXX format
- Subscription/tenant/object IDs → fake GUIDs
- Database connection strings → fake connection strings
- Usernames → user001, admin001, etc.
- Dates of birth → randomize the year
- National ID numbers (SSN, BSN, etc.) → FAKE_ID_XXXXX
- Addresses → 123 Example Street, Anytown

Keep the file structure and syntax valid. Output ONLY the pseudonymized file content, no explanations or code fences.

File content:
`;

      let processed = 0;
      for (const file of files) {
        this.appendTerminalOutput(`Processing: ${file.relativePath}`, 'system');

        try {
          const content = await window.vomit.readFile(file.path);
          const fullPrompt = pseudoPrompt + '\n```\n' + content + '\n```';

          // Collect the AI response
          this.state.pseudoOutput = '';
          this.state.pseudoCollecting = true;

          await window.vomit.claudeExecute(fullPrompt, cwd);

          // Wait for completion
          await this.waitForAIComplete();

          // Save pseudonymized content
          const outputPath = `${outputDir}/${file.relativePath}`;
          await window.vomit.writeFile(outputPath, this.state.pseudoOutput);

          processed++;
          this.appendTerminalOutput(`✓ Saved: pseudonymized/${file.relativePath}`, 'output');
          this.markOutputComplete();
        } catch (err) {
          this.appendTerminalOutput(`✗ Error processing ${file.relativePath}: ${err.message}`, 'error');
        }
      }

      this.appendTerminalOutput(`\nDone! Processed ${processed}/${files.length} files.`, 'system');
      this.appendTerminalOutput(`Output saved to: ${outputDir}`, 'system');

    } catch (err) {
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
    }
  }

  async indexFolderForRAG(projectRoot, targetPath, subpath) {
    const displayPath = subpath ? `/index ${subpath}` : '/index';
    this.appendTerminalOutput(`❯ ${displayPath}`, 'input');
    this.appendTerminalOutput(`Indexing ${subpath || 'folder'} for RAG...`, 'system');
    this.appendTerminalOutput('This requires the nomic-embed-text model. Run: ollama pull nomic-embed-text', 'system');

    try {
      const result = await window.vomit.ragIndex(projectRoot, targetPath);
      if (result.success) {
        this.appendTerminalOutput(`✓ Index complete! ${result.indexed} chunks from ${result.files} files.`, 'output');
        this.appendTerminalOutput('Use /rag <query> to search with context.', 'system');
      } else {
        this.appendTerminalOutput(`✗ Indexing failed: ${result.error}`, 'error');
      }
    } catch (err) {
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
    }
  }

  async searchWithRAG(query, cwd) {
    this.appendTerminalOutput(`❯ /rag ${query}`, 'input');

    try {
      // Search the index for relevant context
      const results = await window.vomit.ragSearch(query, cwd);

      if (!results.success) {
        if (results.error === 'not_indexed') {
          this.appendTerminalOutput('No index found. Run /index first to index your folder.', 'error');
        } else {
          this.appendTerminalOutput(`Search failed: ${results.error}`, 'error');
        }
        return;
      }

      if (results.chunks.length === 0) {
        this.appendTerminalOutput('No relevant context found. Try a different query.', 'system');
        return;
      }

      // Build context from search results
      this.appendTerminalOutput(`Found ${results.chunks.length} relevant chunks. Querying AI...`, 'system');

      const contextParts = results.chunks.map((chunk, i) =>
        `[Source: ${chunk.file}]\n${chunk.content}`
      );
      const context = contextParts.join('\n\n---\n\n');

      const ragPrompt = `You are a helpful assistant. Answer the user's question based on the following context from their project files.

Context from project:
---
${context}
---

User question: ${query}

Provide a helpful, accurate answer based on the context above. If the context doesn't contain relevant information, say so.`;

      this.state.isClaudeRunning = true;
      this.terminalStop.classList.remove('hidden');

      await window.vomit.claudeExecute(ragPrompt, cwd);
    } catch (err) {
      this.appendTerminalOutput(`Error: ${err.message}`, 'error');
    }
  }

  async getFilesRecursively(dir, extensions) {
    const files = [];

    const scan = async (currentDir, relativePath = '') => {
      const items = await window.vomit.getDirectoryContents(currentDir);

      for (const item of items) {
        if (item.name.startsWith('.')) continue; // Skip hidden
        if (item.name === 'pseudonymized') continue; // Skip output dir
        if (item.name === 'node_modules') continue; // Skip node_modules

        const itemRelativePath = relativePath ? `${relativePath}/${item.name}` : item.name;

        if (item.isDirectory) {
          await scan(item.path, itemRelativePath);
        } else {
          const ext = '.' + item.name.split('.').pop().toLowerCase();
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

  appendTerminalOutput(text, type = 'output') {
    // For streaming output, append to a single div element (not pre, to allow nested code blocks)
    if (type === 'output') {
      let outputDiv = this.terminalOutput.querySelector('.terminal-output-stream:not(.complete)');
      if (!outputDiv) {
        outputDiv = document.createElement('div');
        outputDiv.className = 'terminal-line terminal-output-stream output';
        this.terminalOutput.appendChild(outputDiv);
      }
      outputDiv.textContent += text;
      this.terminalOutput.scrollTop = this.terminalOutput.scrollHeight;
      return;
    }

    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.textContent = text;
    this.terminalOutput.appendChild(line);
    this.terminalOutput.scrollTop = this.terminalOutput.scrollHeight;
  }

  markOutputComplete() {
    const outputStream = this.terminalOutput.querySelector('.terminal-output-stream:not(.complete)');
    if (outputStream) {
      outputStream.classList.add('complete');

      // Apply syntax highlighting to code blocks
      this.highlightCodeBlocks(outputStream);
    }
  }

  highlightCodeBlocks(element) {
    const text = element.textContent;

    // Check if there's any markdown to process
    const hasCodeBlocks = /```[\s\S]*?```/.test(text);
    const hasInlineCode = /`[^`]+`/.test(text);

    if (!hasCodeBlocks && !hasInlineCode) {
      return;
    }

    // First, handle fenced code blocks (```language\n...```)
    // Then handle inline code (`...`)
    let html = '';

    // Process fenced code blocks first
    const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      // Add text before the code block (with inline code processed)
      const textBefore = text.slice(lastIndex, match.index);
      html += this.processInlineCode(textBefore);

      // Add highlighted code block
      const language = match[1] || '';
      const code = match[2];

      if (window.hljs && language) {
        try {
          const highlighted = window.hljs.highlight(code, { language: language, ignoreIllegals: true });
          html += `<pre class="terminal-code"><code class="hljs language-${language}">${highlighted.value}</code></pre>`;
        } catch (e) {
          // Fallback to auto-detection
          try {
            const highlighted = window.hljs.highlightAuto(code);
            html += `<pre class="terminal-code"><code class="hljs">${highlighted.value}</code></pre>`;
          } catch (e2) {
            html += `<pre class="terminal-code"><code>${this.escapeHtml(code)}</code></pre>`;
          }
        }
      } else if (window.hljs) {
        try {
          const highlighted = window.hljs.highlightAuto(code);
          html += `<pre class="terminal-code"><code class="hljs">${highlighted.value}</code></pre>`;
        } catch (e) {
          html += `<pre class="terminal-code"><code>${this.escapeHtml(code)}</code></pre>`;
        }
      } else {
        html += `<pre class="terminal-code"><code>${this.escapeHtml(code)}</code></pre>`;
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text after last code block (with inline code processed)
    html += this.processInlineCode(text.slice(lastIndex));

    // Replace content with formatted HTML
    element.innerHTML = html;
  }

  processInlineCode(text) {
    // Replace inline code `...` with styled <code> elements
    // But first escape HTML, then process backticks
    const parts = text.split(/(`[^`]+`)/g);
    let result = '';

    for (const part of parts) {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        // This is inline code
        const code = part.slice(1, -1);
        result += `<code class="terminal-inline-code">${this.escapeHtml(code)}</code>`;
      } else {
        // Regular text
        result += this.escapeHtml(part);
      }
    }

    return result;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  clearTerminal() {
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
      } else {
        titleEl.textContent = 'Claude Terminal';
      }
    }
  }

  async initTerminalTitle() {
    if (window.vomit && window.vomit.getAIProvider) {
      const aiInfo = await window.vomit.getAIProvider();
      this.updateTerminalTitle(aiInfo);
    }
  }
}

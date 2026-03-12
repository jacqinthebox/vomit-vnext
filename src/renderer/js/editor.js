// Editor - Markdown editor with CodeMirror syntax highlighting
class Editor {
  constructor() {
    this.editorContainer = document.getElementById('editor');
    this.preview = document.getElementById('preview');
    this.previewPane = document.getElementById('preview-pane');
    this.statusFile = document.getElementById('status-file');
    this.statusSlides = document.getElementById('status-slides');
    this.statusWords = document.getElementById('status-words');
    this.sidebarFiles = document.getElementById('sidebar-files');
    this.sidebarOutline = document.getElementById('sidebar-outline');
    this.sidebarSearch = document.getElementById('sidebar-search');
    this.outlineList = document.getElementById('outline-list');
    this.fileTree = document.getElementById('file-tree');
    this.searchInput = document.getElementById('search-input');
    this.searchResults = document.getElementById('search-results');
    this.sidebarResize = document.getElementById('sidebar-resize');

    // Unified terminal panel elements
    this.terminalPanel = document.getElementById('terminal-panel');
    this.terminalResize = document.getElementById('terminal-resize');
    this.terminalClear = document.getElementById('terminal-clear');
    this.terminalStop = document.getElementById('terminal-stop');
    this.terminalClose = document.getElementById('terminal-close');
    this.terminalTabs = document.querySelectorAll('.terminal-tab');

    // AI terminal content
    this.aiTerminalContent = document.getElementById('ai-terminal-content');
    this.terminalOutput = document.getElementById('terminal-output');
    this.terminalInput = document.getElementById('terminal-input');

    // Shell terminal content
    this.shellTerminalContent = document.getElementById('shell-terminal-content');
    this.shellTerminalContainer = document.getElementById('shell-terminal-container');
    this.xterm = null; // xterm.js instance
    this.xtermFitAddon = null;

    // Centralized state management
    this.state = new EditorState();

    this.setupEditor();

    // Feature managers (after host is created by setupEditor)
    this.formatting = new FormattingManager({ host: this.host });
    this.searchManager = new SearchManager({
      state: this.state,
      host: this.host,
      dom: {
        searchInput: this.searchInput,
        searchResults: this.searchResults,
        sidebarSearch: this.sidebarSearch,
        sidebarFiles: this.sidebarFiles,
        sidebarOutline: this.sidebarOutline,
        fileTree: this.fileTree,
        outlineList: this.outlineList,
        previewPane: this.previewPane
      }
    });
    this.previewManager = new PreviewManager({
      state: this.state,
      host: this.host,
      dom: {
        preview: this.preview,
        previewPane: this.previewPane,
        editorContainer: this.editorContainer,
        statusFile: this.statusFile,
        statusSlides: this.statusSlides,
        statusWords: this.statusWords,
        outlineList: this.outlineList
      }
    });

    this.setupAutoSave();
    this.setupSidebarResize();
    this.setupFileTreeContextMenu();
    this.searchManager.setup();
    this.setupKeyboardNavigation();
    this.setupTerminal();
    this.setupShellTerminal();
    this.setupIPC();

    // Initialize TabManager
    this.tabManager = new TabManager(this);

    // Check if there's a last session to restore - if not, create empty tab
    this.initializeSession();
  }

  async initializeSession() {
    // Wait a moment for main process to send session data
    const hasSession = await window.vomit.hasLastSession();

    // If no session will be restored, create an empty tab after a short delay
    // (give main process time to send load-content if there is a session)
    if (!hasSession) {
      this.tabManager.createTab(null, '');
    }
    // If there's a session, the main process will send load-content which creates the tab
  }

  setupEditor() {
    // Initialize CodeMirror via host
    this.host = new CodemirrorHost(this.editorContainer, {
      extraKeys: {
        'Tab': (cm) => {
          cm.replaceSelection('  ');
        },
        'Cmd-B': () => this.formatting.wrapSelection('**', '**'),
        'Ctrl-B': () => this.formatting.wrapSelection('**', '**'),
        'Cmd-I': () => this.formatting.wrapSelection('*', '*'),
        'Ctrl-I': () => this.formatting.wrapSelection('*', '*'),
        'Cmd-`': () => this.formatting.wrapSelection('`', '`'),
        'Ctrl-`': () => this.formatting.wrapSelection('`', '`'),
        'Cmd-K': () => this.formatting.insertLink(),
        'Ctrl-K': () => this.formatting.insertLink(),
        'Shift-Cmd-T': () => this.formatting.formatTable(),
        'Shift-Ctrl-T': () => this.formatting.formatTable(),
        'Alt-Z': () => this.formatting.toggleLineWrapping(),
        'Ctrl-J': (cm) => this.showHints(cm),
        'Ctrl-Space': (cm) => this.showHints(cm)
      },
      placeholder: '# Start writing your presentation...\n\nUse --- on its own line to separate slides.\n\nAdd speaker notes after ??? on a slide.'
    });
    this.cm = this.host.cm;  // Backward compat alias

    // Handle changes
    this.cm.on('change', () => {
      this.previewManager.updatePreview();
      this.previewManager.updateStatus();
      this.previewManager.updateOutline();

      // Skip dirty marking if we're restoring a tab
      if (this.state.isRestoringTab) return;

      this.state.isDirty = true;
      window.vomit.contentChanged(this.getValue());

      // Notify TabManager of dirty state
      if (this.tabManager) {
        this.tabManager.markCurrentTabDirty();
      }

      // Debounced auto-save (2 seconds after last change)
      this.scheduleAutoSave();
    });

    // Paste image handling
    this.cm.on('paste', async (cm, e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;

          // Convert to base64
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = reader.result;
            const filename = `image-${Date.now()}.png`;

            // Save image and get path
            const imagePath = await window.vomit.saveImage(base64, filename);
            if (imagePath) {
              // Insert markdown image with default size
              this.formatting.insertText(`![](${imagePath} =400x)`);
            }
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    });
  }

  getValue() {
    return this.cm.getValue();
  }

  setValue(content) {
    this.cm.setValue(content || '');
  }

  showHints(cm) {
    cm.showHint({
      hint: CodeMirror.hint.custom,
      completeSingle: false
    });
  }

  setupIPC() {
    window.addEventListener('vomit:load-content', (e) => {
      const { content, filePath, basePath } = e.detail;

      // Check if file is already open in a tab
      if (filePath) {
        const existingTab = this.tabManager.getTabByPath(filePath);
        if (existingTab) {
          this.tabManager.switchToTab(existingTab.id);
          return;
        }
      }

      // Create new tab for this file
      this.tabManager.saveCurrentTabState();
      const newTab = this.tabManager.createTab(filePath, content);

      // Update directory if basePath is provided
      if (basePath) {
        this.state.basePath = basePath;
        this.state.currentDirectory = basePath;
      }

      this.cm.setOption('filename', filePath); // For hints file-type detection
      this.previewManager.updateEditorMode();
      this.previewManager.applyFrontmatterSettings(content);

      if (this.state.isOutlineVisible) {
        this.previewManager.updateOutline();
      }
      if (this.state.isFileTreeVisible) {
        const preserveFocus = this.state.focusedPane === 'sidebar';
        this.loadFileTree().then(() => {
          if (preserveFocus) {
            const activeItem = this.fileTree.querySelector('.file-item.active');
            if (activeItem) activeItem.focus();
          }
        });
      }
      // Handle pending line jump from search
      if (this.state.pendingLineJump) {
        setTimeout(() => {
          this.previewManager.goToLine(this.state.pendingLineJump - 1);
          this.state.pendingLineJump = null;
        }, 100);
      }
    });

    // Tab management events
    window.addEventListener('vomit:new-tab', () => {
      this.tabManager.createTab(null, '');
    });

    window.addEventListener('vomit:close-tab', () => {
      this.tabManager.closeCurrentTab();
    });

    window.addEventListener('vomit:next-tab', () => {
      this.tabManager.nextTab();
    });

    window.addEventListener('vomit:prev-tab', () => {
      this.tabManager.prevTab();
    });

    window.addEventListener('vomit:go-to-tab', (e) => {
      this.tabManager.goToTab(e.detail);
    });

    window.addEventListener('vomit:request-content', () => {
      window.vomit.saveContent(this.getValue());
      this.state.isDirty = false;
      if (this.tabManager) {
        this.tabManager.markCurrentTabClean();
      }
    });

    window.addEventListener('vomit:file-saved-as', (e) => {
      const filePath = e.detail;
      this.state.currentFilePath = filePath;
      this.state.basePath = filePath ? filePath.substring(0, filePath.lastIndexOf('/')) : null;
      if (this.tabManager) {
        this.tabManager.updateCurrentTabPath(filePath);
      }
    });

    window.addEventListener('vomit:file-saved', (e) => {
      // Update tab path after Save As
      const { filePath } = e.detail || {};
      if (filePath && this.tabManager) {
        this.tabManager.updateCurrentTabPath(filePath);
        this.tabManager.markCurrentTabClean();
      }
    });

    window.addEventListener('vomit:toggle-preview', () => {
      this.previewManager.togglePreview();
    });

    window.addEventListener('vomit:toggle-outline', () => {
      this.toggleOutline();
    });

    window.addEventListener('vomit:toggle-files', () => {
      this.toggleFileTree();
    });

    window.addEventListener('vomit:toggle-word-wrap', () => {
      this.formatting.toggleLineWrapping();
    });

    window.addEventListener('vomit:toggle-line-numbers', () => {
      this.toggleLineNumbers();
    });

    window.addEventListener('vomit:navigate-parent', () => {
      this.navigateToParent();
    });

    window.addEventListener('vomit:show-shortcuts', () => {
      this.showShortcutsModal();
    });

    window.addEventListener('vomit:show-documentation', (e) => {
      this.showDocumentation(e.detail.content, e.detail.filePath);
    });

    window.addEventListener('vomit:toggle-search', () => {
      this.searchManager.toggleSearch();
    });

    window.addEventListener('vomit:find-in-file', () => {
      // Trigger CodeMirror's built-in find dialog
      this.cm.execCommand('find');
    });

    window.addEventListener('vomit:find-and-replace', () => {
      // Trigger CodeMirror's built-in replace dialog
      this.cm.execCommand('replace');
    });

    window.addEventListener('vomit:open-folder', (e) => {
      this.openFolder(e.detail);
    });

    window.addEventListener('vomit:refresh-file-tree', () => {
      this.loadFileTree();
    });

    window.addEventListener('vomit:new-folder', () => {
      this.createNewFolder();
    });

    window.addEventListener('vomit:format-command', (e) => {
      const command = e.detail;
      switch (command) {
        case 'bold': this.formatting.wrapSelection('**', '**'); break;
        case 'italic': this.formatting.wrapSelection('*', '*'); break;
        case 'code': this.formatting.wrapSelection('`', '`'); break;
        case 'link': this.formatting.insertLink(); break;
        case 'table': this.formatting.insertTable(); break;
        case 'formatTable': this.formatting.formatTable(); break;
        case 'h1': this.formatting.insertAtLineStart('# '); break;
        case 'h2': this.formatting.insertAtLineStart('## '); break;
        case 'h3': this.formatting.insertAtLineStart('### '); break;
        case 'bullet': this.formatting.insertAtLineStart('- '); break;
        case 'numbered': this.formatting.insertAtLineStart('1. '); break;
        case 'quote': this.formatting.insertAtLineStart('> '); break;
        case 'hr': this.formatting.insertText('\n---\n'); break;
        case 'slide': this.formatting.insertSlide(); break;
      }
    });

    window.addEventListener('vomit:set-theme', (e) => {
      document.body.className = `theme-${e.detail}`;
      if (this.state.isPreviewVisible) {
        document.body.classList.add('split-view');
      }
      // Update xterm theme to match
      this.updateXtermTheme();
    });

    // Handle external file changes
    window.addEventListener('vomit:file-changed-externally', async (e) => {
      const changedPath = e.detail;
      console.log('Editor: Received file-changed-externally for', changedPath);

      // Check if this file is open in any tab
      if (this.tabManager) {
        const tab = this.tabManager.getTabByPath(changedPath);
        if (tab) {
          await this.handleExternalFileChange(tab);
        }
      } else if (this.state.currentFilePath === changedPath) {
        await this.handleExternalFileChange(null);
      }
    });

    // Command palette
    window.addEventListener('vomit:show-command-palette', () => {
      this.showCommandPalette();
    });

    // Terminal events
    window.addEventListener('vomit:toggle-terminal', () => {
      this.toggleTerminal();
    });

    window.addEventListener('vomit:show-terminal', () => {
      this.showTerminal();
    });

    window.addEventListener('vomit:claude-output', (e) => {
      // Collect output during pseudonymization
      if (this.state.pseudoCollecting) {
        // Strip ANSI escape codes for clean output
        const cleanOutput = e.detail.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
        this.state.pseudoOutput += cleanOutput;
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
      this.markOutputComplete();
      if (e.detail === -1) {
        this.appendTerminalOutput('Stopped.', 'system');
      }
    });

    // Shell terminal events
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

  async handleExternalFileChange(tab) {
    const filePath = tab ? tab.filePath : this.state.currentFilePath;
    const isDirty = tab ? tab.isDirty : this.state.isDirty;
    const filename = filePath ? filePath.split('/').pop() : 'file';

    if (isDirty) {
      // Has local changes - ask user what to do
      const result = await this.showExternalChangeDialog(filename);
      if (result === 'reload') {
        await this.reloadFileContent(filePath, tab);
      }
      // 'keep' - do nothing, keep local changes
    } else {
      // No local changes - auto-reload
      await this.reloadFileContent(filePath, tab);
    }
  }

  async showExternalChangeDialog(filename) {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'shortcuts-modal';
      modal.innerHTML = `
        <div class="shortcuts-content" style="max-width: 400px;">
          <div class="shortcuts-header">
            <h2>File Changed</h2>
          </div>
          <div style="padding: 16px;">
            <p><strong>${filename}</strong> has been modified externally.</p>
            <p style="margin-top: 8px;">You have unsaved changes. What would you like to do?</p>
            <div style="display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end;">
              <button class="dialog-btn" data-action="keep" style="padding: 8px 16px; cursor: pointer;">Keep My Changes</button>
              <button class="dialog-btn dialog-btn-primary" data-action="reload" style="padding: 8px 16px; cursor: pointer; background: var(--accent-color); color: white; border: none; border-radius: 4px;">Reload File</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      modal.querySelectorAll('.dialog-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          modal.remove();
          resolve(btn.dataset.action);
        });
      });
    });
  }

  async reloadFileContent(filePath, tab) {
    const result = await window.vomit.reloadFile(filePath);
    if (result.success) {
      this.state.isRestoringTab = true;

      if (tab && this.tabManager) {
        // Update tab content
        tab.content = result.content;
        tab.isDirty = false;

        // If this is the active tab, update the editor
        if (this.tabManager.activeTabId === tab.id) {
          this.cm.setValue(result.content);
          this.state.isDirty = false;
          this.previewManager.updatePreview();
          this.previewManager.updateStatus();
        }

        this.tabManager.renderTabBar();
      } else {
        // No tabs, just update the editor
        this.cm.setValue(result.content);
        this.state.isDirty = false;
        this.previewManager.updatePreview();
        this.previewManager.updateStatus();
      }

      this.state.isRestoringTab = false;
    }
  }

  toggleFileTree() {
    this.state.isFileTreeVisible = !this.state.isFileTreeVisible;
    this.sidebarFiles.classList.toggle('hidden', !this.state.isFileTreeVisible);
    this.updateResizeHandle();
    if (this.state.isFileTreeVisible) {
      // Close other sidebars
      this.state.isOutlineVisible = false;
      this.state.isSearchVisible = false;
      this.sidebarOutline.classList.add('hidden');
      this.sidebarSearch.classList.add('hidden');
      this.state.focusedPane = 'sidebar';
      this.loadFileTree().then(() => {
        const firstItem = this.fileTree.querySelector('.file-item');
        if (firstItem) firstItem.focus();
      });
    } else {
      // Return focus to editor when hiding
      this.state.focusedPane = 'editor';
      this.cm.focus();
    }
  }

  toggleOutline() {
    this.state.isOutlineVisible = !this.state.isOutlineVisible;
    this.sidebarOutline.classList.toggle('hidden', !this.state.isOutlineVisible);
    this.updateResizeHandle();
    if (this.state.isOutlineVisible) {
      // Close other sidebars
      this.state.isFileTreeVisible = false;
      this.state.isSearchVisible = false;
      this.sidebarFiles.classList.add('hidden');
      this.sidebarSearch.classList.add('hidden');
      this.previewManager.updateOutline();
    }
  }

  toggleLineNumbers() {
    const current = this.cm.getOption('lineNumbers');
    this.cm.setOption('lineNumbers', !current);
  }

  showShortcutsModal() {
    // Remove existing modal if any
    const existing = document.querySelector('.shortcuts-modal');
    if (existing) {
      existing.remove();
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'shortcuts-modal';
    modal.innerHTML = `
      <div class="shortcuts-content">
        <div class="shortcuts-header">
          <h2>Keyboard Shortcuts</h2>
          <button class="shortcuts-close">&times;</button>
        </div>
        <div class="shortcuts-body">
          <div class="shortcuts-section">
            <h3>Tabs</h3>
            <div class="shortcut-row"><kbd>Cmd+T</kbd> New tab</div>
            <div class="shortcut-row"><kbd>Cmd+W</kbd> Close tab</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+]</kbd> Next tab</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+[</kbd> Previous tab</div>
            <div class="shortcut-row"><kbd>Cmd+1-9</kbd> Go to tab</div>
          </div>
          <div class="shortcuts-section">
            <h3>File</h3>
            <div class="shortcut-row"><kbd>Cmd+N</kbd> New file</div>
            <div class="shortcut-row"><kbd>Cmd+O</kbd> Open file</div>
            <div class="shortcut-row"><kbd>Cmd+S</kbd> Save</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+S</kbd> Save as</div>
          </div>
          <div class="shortcuts-section">
            <h3>View</h3>
            <div class="shortcut-row"><kbd>Cmd+.</kbd> Command palette</div>
            <div class="shortcut-row"><kbd>Cmd+P</kbd> Toggle preview</div>
            <div class="shortcut-row"><kbd>Cmd+E</kbd> Toggle explorer</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+O</kbd> Toggle outline</div>
            <div class="shortcut-row"><kbd>Cmd+L</kbd> Toggle line numbers</div>
            <div class="shortcut-row"><kbd>Cmd+F</kbd> Find in file</div>
            <div class="shortcut-row"><kbd>Cmd+Option+F</kbd> Find and replace</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+F</kbd> Search in files</div>
            <div class="shortcut-row"><kbd>Cmd+/</kbd> Show shortcuts</div>
          </div>
          <div class="shortcuts-section">
            <h3>Format</h3>
            <div class="shortcut-row"><kbd>Cmd+B</kbd> Bold</div>
            <div class="shortcut-row"><kbd>Cmd+I</kbd> Italic</div>
            <div class="shortcut-row"><kbd>Cmd+\`</kbd> Code</div>
            <div class="shortcut-row"><kbd>Cmd+K</kbd> Insert link</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+T</kbd> Insert table</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+1/2/3</kbd> Headings</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+8</kbd> Bullet list</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+9</kbd> Numbered list</div>
            <div class="shortcut-row"><kbd>Cmd+'</kbd> Quote</div>
            <div class="shortcut-row"><kbd>Cmd+-</kbd> Horizontal rule</div>
            <div class="shortcut-row"><kbd>Cmd+Enter</kbd> New slide</div>
          </div>
          <div class="shortcuts-section">
            <h3>Code</h3>
            <div class="shortcut-row"><kbd>Ctrl+J</kbd> Autocomplete</div>
            <div class="shortcut-row"><kbd>Ctrl+Space</kbd> Autocomplete</div>
          </div>
          <div class="shortcuts-section">
            <h3>Explorer</h3>
            <div class="shortcut-row"><kbd>↑↓</kbd> Navigate files</div>
            <div class="shortcut-row"><kbd>←→</kbd> Navigate folders</div>
            <div class="shortcut-row"><kbd>Enter</kbd> Open file/folder</div>
            <div class="shortcut-row"><kbd>Ctrl+Tab</kbd> Switch to editor</div>
            <div class="shortcut-row"><kbd>Escape</kbd> Return to editor</div>
          </div>
          <div class="shortcuts-section">
            <h3>Presentation</h3>
            <div class="shortcut-row"><kbd>Cmd+Shift+P</kbd> Start presentation</div>
            <div class="shortcut-row"><kbd>Cmd+Alt+P</kbd> With presenter view</div>
            <div class="shortcut-row"><kbd>→/Space/N</kbd> Next slide</div>
            <div class="shortcut-row"><kbd>←/P</kbd> Previous slide</div>
            <div class="shortcut-row"><kbd>L</kbd> Laser pointer</div>
            <div class="shortcut-row"><kbd>Escape</kbd> End presentation</div>
          </div>
          <div class="shortcuts-section">
            <h3>AI Terminal</h3>
            <div class="shortcut-row"><kbd>Ctrl+\`</kbd> Toggle AI terminal</div>
            <div class="shortcut-row"><kbd>Ctrl+C</kbd> Stop AI response</div>
            <div class="shortcut-row"><kbd>Cmd+K</kbd> Clear terminal</div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    const close = () => modal.remove();
    modal.querySelector('.shortcuts-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', handler);
      }
    });
  }

  showDocumentation(content, filePath) {
    // Open documentation in a new tab with preview enabled
    this.tabManager.createTab(filePath || 'Documentation', content);

    // Enable preview mode for documentation
    if (!this.state.isPreviewVisible) {
      this.previewManager.togglePreview();
    }
  }

  navigateToParent() {
    if (!this.state.currentDirectory) return;
    // Don't navigate above project root
    if (this.state.projectRoot && this.state.currentDirectory === this.state.projectRoot) return;

    const parts = this.state.currentDirectory.split('/');
    if (parts.length > 2) {
      const newDir = parts.slice(0, -1).join('/');
      // Extra check: don't go above project root
      if (this.state.projectRoot && !newDir.startsWith(this.state.projectRoot)) return;

      this.state.currentDirectory = newDir;
      this.loadFileTree().then(() => {
        // Focus first item after navigating up
        const firstItem = this.fileTree.querySelector('.file-item');
        if (firstItem) firstItem.focus();
      });
    }
  }

  openFolder(folderPath) {
    // Close all existing tabs when opening/switching projects (don't auto-create untitled)
    if (this.tabManager) {
      // If switching projects OR first time opening a folder with only an empty untitled tab
      const hasOnlyEmptyUntitled = this.tabManager.tabs.size === 1 &&
        !this.tabManager.tabs.values().next().value.filePath &&
        !this.tabManager.tabs.values().next().value.content.trim();

      if ((this.state.projectRoot && this.state.projectRoot !== folderPath) || hasOnlyEmptyUntitled) {
        this.tabManager.closeAllTabs(true, false);
      }
    }

    this.state.currentDirectory = folderPath;
    this.state.projectRoot = folderPath; // Set as project root - can't navigate above this

    // Update sidebar header with folder name
    const folderName = folderPath.split('/').pop().toUpperCase();
    const sidebarFolderName = document.getElementById('sidebar-folder-name');
    if (sidebarFolderName) {
      sidebarFolderName.textContent = folderName;
    }

    // Load file tree data (but don't show sidebar - user can toggle with Cmd+E)
    this.loadFileTree();
  }

  setupKeyboardNavigation() {
    // Ctrl+W or Ctrl+Tab to toggle focus between editor and sidebar
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && (e.key === 'w' || e.key === 'Tab')) {
        e.preventDefault();
        this.searchManager.togglePaneFocus();
      }
    });
  }

  async setupAutoSave() {
    // Load initial auto-save state from main process
    if (window.vomit && window.vomit.getAutoSaveEnabled) {
      this.state.autoSaveEnabled = await window.vomit.getAutoSaveEnabled();
    }

    // Listen for auto-save toggle changes
    window.addEventListener('vomit:auto-save-changed', (e) => {
      this.state.autoSaveEnabled = e.detail;
      console.log('Auto-save', this.state.autoSaveEnabled ? 'enabled' : 'disabled');
    });

    // Save when window loses focus
    window.addEventListener('blur', () => {
      if (this.state.autoSaveEnabled && this.state.isDirty && this.state.currentFilePath) {
        this.autoSave();
      }
    });

    // Save before closing/navigating away
    window.addEventListener('beforeunload', (e) => {
      if (this.state.autoSaveEnabled && this.state.isDirty && this.state.currentFilePath) {
        this.autoSave();
      }
    });
  }

  scheduleAutoSave() {
    // Only auto-save if enabled and file has been saved before (has a path)
    if (!this.state.autoSaveEnabled || !this.state.currentFilePath) return;

    // Clear existing timeout
    clearTimeout(this.state.autoSaveTimeout);

    // Schedule save for 2 seconds after last change
    this.state.autoSaveTimeout = setTimeout(() => {
      if (this.state.isDirty && this.state.autoSaveEnabled) {
        this.autoSave();
      }
    }, 2000);
  }

  autoSave() {
    if (!this.state.autoSaveEnabled || !this.state.isDirty || !this.state.currentFilePath) return;

    window.vomit.saveContent(this.getValue());
    this.state.isDirty = false;
    this.previewManager.updateStatus();
  }

  setupSidebarResize() {
    let isResizing = false;
    let currentSidebar = null;

    this.sidebarResize.addEventListener('mousedown', (e) => {
      isResizing = true;
      this.sidebarResize.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      // Find which sidebar is visible
      if (this.state.isFileTreeVisible) currentSidebar = this.sidebarFiles;
      else if (this.state.isOutlineVisible) currentSidebar = this.sidebarOutline;
      else if (this.state.isSearchVisible) currentSidebar = this.sidebarSearch;
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing || !currentSidebar) return;

      const newWidth = Math.max(150, Math.min(500, e.clientX));
      currentSidebar.style.width = `${newWidth}px`;
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        currentSidebar = null;
        this.sidebarResize.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  setupFileTreeContextMenu() {
    // Context menu for sidebar header (create folder at project root)
    const sidebarHeader = this.sidebarFiles.querySelector('.sidebar-header');
    if (sidebarHeader) {
      sidebarHeader.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.state.projectRoot) {
          this.showRootContextMenu(e.clientX, e.clientY);
        }
      });
    }

    // Context menu for file tree empty space (create folder at current directory)
    this.fileTree.addEventListener('contextmenu', (e) => {
      // Only trigger if clicking on the file tree itself, not on file items
      if (e.target === this.fileTree || e.target.classList.contains('empty-message')) {
        e.preventDefault();
        if (this.state.currentDirectory) {
          this.showRootContextMenu(e.clientX, e.clientY);
        }
      }
    });
  }

  showRootContextMenu(x, y) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.file-context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'file-context-menu';
    menu.innerHTML = `
      <div class="context-menu-item" data-action="new-file">New File</div>
      <div class="context-menu-item" data-action="new-folder">New Folder</div>
    `;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);

    // Handle menu item clicks
    menu.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'new-file') {
        this.createNewFile(this.state.currentDirectory);
      } else if (action === 'new-folder') {
        this.createNewFolder(this.state.currentDirectory);
      }
      menu.remove();
    });

    // Close menu on outside click
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  updateResizeHandle() {
    const anySidebarVisible = this.state.isFileTreeVisible || this.state.isOutlineVisible || this.state.isSearchVisible;
    this.sidebarResize.classList.toggle('hidden', !anySidebarVisible);
  }

  async loadFileTree() {
    if (!this.state.currentDirectory) {
      // Try to get current directory from main process
      this.state.currentDirectory = await window.vomit.getCurrentDirectory();
    }

    if (!this.state.currentDirectory) {
      this.fileTree.innerHTML = '<div class="file-item" style="color: var(--text-muted); padding: 16px;">Open a file to see its directory</div>';
      return;
    }

    const items = await window.vomit.getDirectoryContents(this.state.currentDirectory);
    this.renderFileTree(items);
  }

  renderFileTree(items) {
    if (!items || items.length === 0) {
      this.fileTree.innerHTML = '<div class="file-item empty-message" style="color: var(--text-muted);">Empty folder</div>';
      return;
    }

    // Cache items for the current directory
    this.state.treeCache.set(this.state.currentDirectory, items);

    // Render tree starting from root
    this.fileTree.innerHTML = '';

    // Add ".." parent item if not at project root
    const isAtProjectRoot = this.state.projectRoot && this.state.currentDirectory === this.state.projectRoot;
    if (!isAtProjectRoot && this.state.currentDirectory) {
      const parentItem = document.createElement('div');
      parentItem.className = 'file-item directory parent-dir';
      parentItem.dataset.path = this.state.currentDirectory.split('/').slice(0, -1).join('/');
      parentItem.dataset.isDir = 'true';
      parentItem.dataset.depth = '0';
      parentItem.tabIndex = 0;
      parentItem.style.paddingLeft = '8px';
      parentItem.innerHTML = `
        <span class="chevron"></span>
        <span class="icon"></span>
        <span class="name">..</span>
      `;
      parentItem.addEventListener('click', () => this.navigateToParent());
      parentItem.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.navigateToParent();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.focusNextTreeItem(parentItem);
        }
      });
      this.fileTree.appendChild(parentItem);
    }

    this.renderTreeItems(items, this.fileTree, 0);
    this.attachTreeHandlers();
  }

  renderTreeItems(items, container, depth) {
    const chevronSvg = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4"/></svg>`;

    items.forEach(item => {
      const isActive = item.path === this.state.currentFilePath;
      const isExpanded = this.state.expandedFolders.has(item.path);
      const typeClass = item.isDirectory ? 'directory' : (item.isMarkdown ? 'markdown' : 'file');
      const activeClass = isActive ? 'active' : '';
      const expandedClass = isExpanded ? 'expanded' : '';
      const indent = depth * 16;

      const itemEl = document.createElement('div');
      itemEl.className = `file-item ${typeClass} ${activeClass} ${expandedClass}`.trim();
      itemEl.dataset.path = item.path;
      itemEl.dataset.isDir = item.isDirectory;
      itemEl.dataset.depth = depth;
      itemEl.tabIndex = 0;
      itemEl.style.paddingLeft = `${8 + indent}px`;
      itemEl.innerHTML = `
        <span class="chevron">${chevronSvg}</span>
        <span class="icon"></span>
        <span class="name">${item.name}</span>
      `;
      container.appendChild(itemEl);

      // If directory is expanded and we have cached children, render them
      if (item.isDirectory && isExpanded) {
        const childContainer = document.createElement('div');
        childContainer.className = 'tree-children expanded';
        childContainer.dataset.parentPath = item.path;
        container.appendChild(childContainer);

        const cachedChildren = this.state.treeCache.get(item.path);
        if (cachedChildren) {
          this.renderTreeItems(cachedChildren, childContainer, depth + 1);
        }
      }
    });
  }

  attachTreeHandlers() {
    this.fileTree.querySelectorAll('.file-item').forEach(el => {
      const handleToggle = async () => {
        const filePath = el.dataset.path;
        const isDir = el.dataset.isDir === 'true';

        if (isDir) {
          await this.toggleFolder(el, filePath);
        } else {
          // Update active state
          this.fileTree.querySelectorAll('.file-item.active').forEach(item => item.classList.remove('active'));
          el.classList.add('active');
          this.state.focusedPane = 'sidebar';
          window.vomit.openFile(filePath);
        }
      };

      el.addEventListener('click', handleToggle);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleToggle();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.focusNextTreeItem(el);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.focusPrevTreeItem(el);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          const isDir = el.dataset.isDir === 'true';
          const isExpanded = el.classList.contains('expanded');
          if (isDir && !isExpanded) {
            handleToggle();
          } else if (isDir && isExpanded) {
            this.focusNextTreeItem(el);
          }
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const isDir = el.dataset.isDir === 'true';
          const isExpanded = el.classList.contains('expanded');
          if (isDir && isExpanded) {
            handleToggle();
          } else {
            this.focusParentFolder(el);
          }
        } else if (e.key === 'Escape') {
          this.cm.focus();
          this.state.focusedPane = 'editor';
        }
      });

      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showFileContextMenu(el, e.clientX, e.clientY);
      });
    });
  }

  async toggleFolder(el, folderPath) {
    const isExpanded = el.classList.contains('expanded');

    if (isExpanded) {
      // Collapse: remove expanded class and children container
      el.classList.remove('expanded');
      this.state.expandedFolders.delete(folderPath);
      const childContainer = el.nextElementSibling;
      if (childContainer && childContainer.classList.contains('tree-children')) {
        childContainer.remove();
      }
    } else {
      // Expand: add expanded class and load children
      el.classList.add('expanded');
      this.state.expandedFolders.add(folderPath);

      // Check cache first
      let children = this.state.treeCache.get(folderPath);
      if (!children) {
        children = await window.vomit.getDirectoryContents(folderPath);
        this.state.treeCache.set(folderPath, children);
      }

      if (children && children.length > 0) {
        const childContainer = document.createElement('div');
        childContainer.className = 'tree-children expanded';
        childContainer.dataset.parentPath = folderPath;
        el.after(childContainer);

        const depth = parseInt(el.dataset.depth) + 1;
        this.renderTreeItems(children, childContainer, depth);
        this.attachTreeHandlers();
      }
    }
  }

  focusNextTreeItem(el) {
    // Get all visible file items
    const allItems = Array.from(this.fileTree.querySelectorAll('.file-item'));
    const currentIndex = allItems.indexOf(el);
    if (currentIndex < allItems.length - 1) {
      allItems[currentIndex + 1].focus();
    }
  }

  focusPrevTreeItem(el) {
    const allItems = Array.from(this.fileTree.querySelectorAll('.file-item'));
    const currentIndex = allItems.indexOf(el);
    if (currentIndex > 0) {
      allItems[currentIndex - 1].focus();
    }
  }

  focusParentFolder(el) {
    // Find the parent folder by looking at depth
    const depth = parseInt(el.dataset.depth);
    if (depth === 0) return;

    const allItems = Array.from(this.fileTree.querySelectorAll('.file-item'));
    const currentIndex = allItems.indexOf(el);

    // Search backwards for an item with lower depth
    for (let i = currentIndex - 1; i >= 0; i--) {
      const itemDepth = parseInt(allItems[i].dataset.depth);
      if (itemDepth < depth) {
        allItems[i].focus();
        return;
      }
    }
  }


  showFileContextMenu(el, x, y) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.file-context-menu');
    if (existingMenu) existingMenu.remove();

    const filePath = el.dataset.path;
    const isParentDir = el.classList.contains('parent-dir');

    // Don't show menu for parent directory (..)
    if (isParentDir) return;

    const isDir = el.dataset.isDir === 'true';
    const menu = document.createElement('div');
    menu.className = 'file-context-menu';
    menu.innerHTML = `
      <div class="context-menu-item" data-action="new-file">New File</div>
      <div class="context-menu-item" data-action="new-folder">New Folder</div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="rename">Rename</div>
      <div class="context-menu-item" data-action="delete">Delete</div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="finder">Show in Finder</div>
    `;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);

    // Handle menu item clicks
    menu.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'new-file') {
        const targetDir = isDir ? filePath : this.state.currentDirectory;
        this.createNewFile(targetDir);
      } else if (action === 'new-folder') {
        const targetDir = isDir ? filePath : this.state.currentDirectory;
        this.createNewFolder(targetDir);
      } else if (action === 'rename') {
        this.startRename(el);
      } else if (action === 'delete') {
        this.deleteItem(filePath);
      } else if (action === 'finder') {
        window.vomit.showInFinder(filePath);
      }
      menu.remove();
    });

    // Close menu on outside click
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  startRename(el) {
    const filePath = el.dataset.path;
    const nameSpan = el.querySelector('.name');
    const currentName = nameSpan.textContent;

    // Create inline input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = currentName;

    // Replace name span with input
    nameSpan.style.display = 'none';
    el.appendChild(input);
    input.focus();
    input.select();

    const finishRename = async (save) => {
      if (save) {
        const newName = input.value.trim();
        if (newName && newName !== currentName) {
          const result = await window.vomit.renameItem(filePath, newName);
          if (!result.success) {
            alert(result.error || 'Failed to rename');
          }
        }
      }
      input.remove();
      nameSpan.style.display = '';
      this.loadFileTree();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finishRename(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finishRename(false);
      }
    });

    input.addEventListener('blur', () => {
      finishRename(true);
    });
  }

  async deleteItem(itemPath) {
    const result = await window.vomit.deleteItem(itemPath);
    if (result.success) {
      // Close tab if the deleted file was open
      if (this.tabManager) {
        const tab = this.tabManager.getTabByPath(itemPath);
        if (tab) {
          // Force close without prompting for save (file is already deleted)
          this.tabManager.tabs.delete(tab.id);
          this.tabManager.tabOrder = this.tabManager.tabOrder.filter(id => id !== tab.id);

          // If it was the active tab, switch to another
          if (tab.id === this.tabManager.activeTabId) {
            if (this.tabManager.tabOrder.length === 0) {
              this.tabManager.activeTabId = null;
              this.tabManager.createTab();
            } else {
              this.tabManager.activeTabId = null;
              this.tabManager.switchToTab(this.tabManager.tabOrder[0]);
            }
          } else {
            this.tabManager.renderTabBar();
          }
        }
      }
      // Clear tree cache for parent directory to force refresh
      const parentDir = itemPath.substring(0, itemPath.lastIndexOf('/'));
      this.state.treeCache.delete(parentDir);
      // Also remove from expanded folders if it was a folder
      this.state.expandedFolders.delete(itemPath);
      this.loadFileTree();
    } else if (result.error) {
      alert(result.error);
    }
  }

  async createNewFolder(parentDir) {
    // Use current directory if no parent specified
    const targetDir = parentDir || this.state.currentDirectory;
    if (!targetDir) {
      alert('No folder open. Open a folder first.');
      return;
    }

    // Create inline input in the file tree
    const inputContainer = document.createElement('div');
    inputContainer.className = 'file-item new-folder-input';
    inputContainer.innerHTML = `
      <span class="icon">📁</span>
      <input type="text" class="rename-input" placeholder="folder name" value="New Folder">
    `;

    // Find where to insert the input
    // If the parent folder is expanded, insert at the start of its children
    const parentEl = this.fileTree.querySelector(`.file-item[data-path="${CSS.escape(targetDir)}"]`);
    let insertTarget = this.fileTree;

    if (parentEl && parentEl.dataset.isDir === 'true') {
      const childContainer = parentEl.nextElementSibling;
      if (childContainer && childContainer.classList.contains('tree-children')) {
        insertTarget = childContainer;
      } else {
        // Expand folder first if not expanded
        if (!parentEl.classList.contains('expanded')) {
          await this.toggleFolder(parentEl, targetDir);
        }
        const newChildContainer = parentEl.nextElementSibling;
        if (newChildContainer && newChildContainer.classList.contains('tree-children')) {
          insertTarget = newChildContainer;
        }
      }
    }

    // Insert at the beginning of the target container
    insertTarget.insertBefore(inputContainer, insertTarget.firstChild);

    const input = inputContainer.querySelector('input');
    input.focus();
    input.select();

    const finishCreate = async (save) => {
      if (save) {
        const folderName = input.value.trim();
        if (folderName) {
          const newFolderPath = `${targetDir}/${folderName}`;
          try {
            await window.vomit.createDirectory(newFolderPath);
            // Clear tree cache for parent to force refresh
            this.state.treeCache.delete(targetDir);
          } catch (err) {
            alert(`Failed to create folder: ${err.message}`);
          }
        }
      }
      inputContainer.remove();
      this.loadFileTree();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finishCreate(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finishCreate(false);
      }
    });

    input.addEventListener('blur', () => {
      finishCreate(true);
    });
  }

  async createNewFile(parentDir) {
    // Use current directory if no parent specified
    const targetDir = parentDir || this.state.currentDirectory;
    if (!targetDir) {
      alert('No folder open. Open a folder first.');
      return;
    }

    // Create inline input in the file tree
    const inputContainer = document.createElement('div');
    inputContainer.className = 'file-item new-file-input';
    inputContainer.innerHTML = `
      <span class="icon">📄</span>
      <input type="text" class="rename-input" placeholder="filename.md" value="untitled.md">
    `;

    // Find where to insert the input
    const parentEl = this.fileTree.querySelector(`.file-item[data-path="${CSS.escape(targetDir)}"]`);
    let insertTarget = this.fileTree;

    if (parentEl && parentEl.dataset.isDir === 'true') {
      const childContainer = parentEl.nextElementSibling;
      if (childContainer && childContainer.classList.contains('tree-children')) {
        insertTarget = childContainer;
      } else {
        // Expand folder first if not expanded
        if (!parentEl.classList.contains('expanded')) {
          await this.toggleFolder(parentEl, targetDir);
        }
        const newChildContainer = parentEl.nextElementSibling;
        if (newChildContainer && newChildContainer.classList.contains('tree-children')) {
          insertTarget = newChildContainer;
        }
      }
    }

    // Insert at the beginning of the target container
    insertTarget.insertBefore(inputContainer, insertTarget.firstChild);

    const input = inputContainer.querySelector('input');
    input.focus();
    // Select just the filename part, not the extension
    const dotIndex = input.value.lastIndexOf('.');
    if (dotIndex > 0) {
      input.setSelectionRange(0, dotIndex);
    } else {
      input.select();
    }

    const finishCreate = async (save) => {
      if (save) {
        const fileName = input.value.trim();
        if (fileName) {
          const newFilePath = `${targetDir}/${fileName}`;
          try {
            // Create empty file
            await window.vomit.writeFile(newFilePath, '');
            // Clear tree cache for parent to force refresh
            this.state.treeCache.delete(targetDir);
            // Open the new file
            window.vomit.openFile(newFilePath);
          } catch (err) {
            alert(`Failed to create file: ${err.message}`);
          }
        }
      }
      inputContainer.remove();
      this.loadFileTree();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finishCreate(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finishCreate(false);
      }
    });

    input.addEventListener('blur', () => {
      finishCreate(true);
    });
  }

  async showCommandPalette() {
    // Remove existing palette if any
    const existing = document.querySelector('.command-palette');
    if (existing) {
      existing.remove();
      return;
    }

    // Define all commands
    const commands = [
      // File commands
      { section: 'File', label: 'New Tab', shortcut: '⌘T', action: () => this.tabManager.createTab(null, '') },
      { section: 'File', label: 'New Window', shortcut: '⌘⇧N', action: () => {} }, // Handled by main process
      { section: 'File', label: 'New File', shortcut: '⌘N', action: () => window.vomit.newFile() },
      { section: 'File', label: 'New Presentation', shortcut: '⌘⌥N', action: () => window.vomit.newPresentation() },
      { section: 'File', label: 'Open File', shortcut: '⌘O', action: () => window.vomit.openFileDialog() },
      { section: 'File', label: 'Open Folder', shortcut: '⌘⌥O', action: () => window.vomit.openFolderDialog() },
      { section: 'File', label: 'New Folder', shortcut: '⌘⇧F', action: () => this.createNewFolder() },
      { section: 'File', label: 'New File in Folder', shortcut: '⌘⇧N', action: () => this.createNewFile() },
      { section: 'File', label: 'Save', shortcut: '⌘S', action: () => window.vomit.saveContent(this.getValue()) },
      { section: 'File', label: 'Save As', shortcut: '⌘⇧S', action: () => window.vomit.saveAs() },
      { section: 'File', label: 'Close Tab', shortcut: '⌘W', action: () => this.tabManager.closeCurrentTab() },

      // View commands
      { section: 'View', label: 'Toggle Preview', shortcut: '⌘P', action: () => this.previewManager.togglePreview() },
      { section: 'View', label: 'Toggle Files', shortcut: '⌘E', action: () => this.toggleFileTree() },
      { section: 'View', label: 'Toggle Outline', shortcut: '⌘⇧O', action: () => this.toggleOutline() },
      { section: 'View', label: 'Toggle Line Numbers', shortcut: '⌘L', action: () => this.toggleLineNumbers() },
      { section: 'View', label: 'Toggle Word Wrap', shortcut: '⌥Z', action: () => this.formatting.toggleLineWrapping() },
      { section: 'View', label: 'Find in File', shortcut: '⌘F', action: () => this.cm.execCommand('find') },
      { section: 'View', label: 'Find and Replace', shortcut: '⌘⌥F', action: () => this.cm.execCommand('replace') },
      { section: 'View', label: 'Search in Files', shortcut: '⌘⇧F', action: () => this.searchManager.toggleSearch() },

      // Format commands
      { section: 'Format', label: 'Bold', shortcut: '⌘B', action: () => this.formatting.wrapSelection('**', '**') },
      { section: 'Format', label: 'Italic', shortcut: '⌘I', action: () => this.formatting.wrapSelection('*', '*') },
      { section: 'Format', label: 'Code', shortcut: '⌘`', action: () => this.formatting.wrapSelection('`', '`') },
      { section: 'Format', label: 'Link', shortcut: '⌘K', action: () => this.formatting.insertLink() },
      { section: 'Format', label: 'Insert Table', action: () => this.formatting.insertTable() },
      { section: 'Format', label: 'Format Table', shortcut: '⌘⇧T', action: () => this.formatting.formatTable() },
      { section: 'Format', label: 'Heading 1', shortcut: '⌘⇧1', action: () => this.formatting.insertAtLineStart('# ') },
      { section: 'Format', label: 'Heading 2', shortcut: '⌘⇧2', action: () => this.formatting.insertAtLineStart('## ') },
      { section: 'Format', label: 'Heading 3', shortcut: '⌘⇧3', action: () => this.formatting.insertAtLineStart('### ') },
      { section: 'Format', label: 'Bullet List', shortcut: '⌘⇧8', action: () => this.formatting.insertAtLineStart('- ') },
      { section: 'Format', label: 'Numbered List', shortcut: '⌘⇧9', action: () => this.formatting.insertAtLineStart('1. ') },
      { section: 'Format', label: 'Quote', shortcut: "⌘'", action: () => this.formatting.insertAtLineStart('> ') },
      { section: 'Format', label: 'Horizontal Rule', shortcut: '⌘-', action: () => this.formatting.insertText('\n---\n') },
      { section: 'Format', label: 'Insert Slide', shortcut: '⌘↵', action: () => this.formatting.insertSlide() },

      // Navigation
      { section: 'Navigation', label: 'Next Tab', shortcut: '⌘⇧]', action: () => this.tabManager.nextTab() },
      { section: 'Navigation', label: 'Previous Tab', shortcut: '⌘⇧[', action: () => this.tabManager.prevTab() },
      { section: 'Navigation', label: 'Go to Parent Folder', shortcut: '⌘↑', action: () => this.navigateToParent() },

      // Presentation
      { section: 'Presentation', label: 'Start Presentation', shortcut: '⌘⇧P', action: () => window.vomit.startPresentation() },
      { section: 'Presentation', label: 'Start with Presenter View', shortcut: '⌘⌥P', action: () => window.vomit.startPresentationWithPresenter() },

      // Help
      { section: 'Help', label: 'Keyboard Shortcuts', shortcut: '⌘/', action: () => this.showShortcutsModal() },
    ];

    // Get recent files
    let recentFiles = [];
    if (window.vomit && window.vomit.getRecentFiles) {
      recentFiles = await window.vomit.getRecentFiles();
    }

    // Add recent files as commands
    recentFiles.forEach(file => {
      commands.push({
        section: 'Recent Files',
        label: file.name,
        sublabel: file.path,
        action: () => window.vomit.openFile(file.path)
      });
    });

    // Create palette UI
    const palette = document.createElement('div');
    palette.className = 'command-palette';

    const content = document.createElement('div');
    content.className = 'command-palette-content';

    const input = document.createElement('input');
    input.className = 'command-palette-input';
    input.placeholder = 'Type a command or search...';

    const results = document.createElement('div');
    results.className = 'command-palette-results';

    content.appendChild(input);
    content.appendChild(results);
    palette.appendChild(content);
    document.body.appendChild(palette);

    let selectedIndex = 0;
    let filteredCommands = [...commands];

    const renderResults = () => {
      if (filteredCommands.length === 0) {
        results.innerHTML = '<div class="command-palette-empty">No matching commands</div>';
        return;
      }

      let html = '';
      let currentSection = '';

      filteredCommands.forEach((cmd, index) => {
        if (cmd.section !== currentSection) {
          currentSection = cmd.section;
          html += `<div class="command-palette-section">${currentSection}</div>`;
        }

        const selected = index === selectedIndex ? 'selected' : '';
        const shortcut = cmd.shortcut ? `<span class="shortcut">${cmd.shortcut}</span>` : '';
        html += `<div class="command-palette-item ${selected}" data-index="${index}">
          <span class="label">${cmd.label}</span>
          ${shortcut}
        </div>`;
      });

      results.innerHTML = html;

      // Add click handlers
      results.querySelectorAll('.command-palette-item').forEach(el => {
        el.addEventListener('click', () => {
          const idx = parseInt(el.dataset.index, 10);
          executeCommand(idx);
        });
      });

      // Scroll selected into view
      const selected = results.querySelector('.selected');
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    };

    const filterCommands = (query) => {
      if (!query.trim()) {
        filteredCommands = [...commands];
      } else {
        const q = query.toLowerCase();
        filteredCommands = commands.filter(cmd =>
          cmd.label.toLowerCase().includes(q) ||
          (cmd.section && cmd.section.toLowerCase().includes(q))
        );
      }
      selectedIndex = 0;
      renderResults();
    };

    const executeCommand = (index) => {
      const cmd = filteredCommands[index];
      if (cmd && cmd.action) {
        palette.remove();
        cmd.action();
        this.cm.focus();
      }
    };

    const close = () => {
      palette.remove();
      this.cm.focus();
    };

    // Event handlers
    input.addEventListener('input', () => filterCommands(input.value));

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, filteredCommands.length - 1);
        renderResults();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        renderResults();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executeCommand(selectedIndex);
      } else if (e.key === 'Escape') {
        close();
      }
    });

    palette.addEventListener('click', (e) => {
      if (e.target === palette) close();
    });

    // Initial render and focus
    renderResults();
    input.focus();
  }

  // Terminal methods
  setupTerminal() {
    if (!this.terminalInput) return;

    // Handle input submission
    this.terminalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
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
        if (this.state.isClaudeRunning) {
          this.stopAI();
        } else {
          // Close the terminal panel
          this.state.isTerminalPanelVisible = false;
          this.terminalPanel.classList.add('hidden');
          this.cm.focus();
        }
      } else if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.clearTerminal();
      }
    });

    // Clear button - clears active terminal
    this.terminalClear.addEventListener('click', () => {
      if (this.state.activeTerminalTab === 'ai') {
        this.clearTerminal();
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
      this.cm.focus();
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
    if (this.state.isTerminalPanelVisible && this.state.activeTerminalTab === 'ai') {
      // Already showing AI terminal, close the panel
      this.state.isTerminalPanelVisible = false;
      this.terminalPanel.classList.add('hidden');
      this.cm.focus();
    } else {
      // Show panel and switch to AI tab
      this.state.isTerminalPanelVisible = true;
      this.terminalPanel.classList.remove('hidden');
      this.switchTerminalTab('ai');
    }
  }

  showTerminal() {
    if (!this.state.isTerminalPanelVisible || this.state.activeTerminalTab !== 'ai') {
      this.state.isTerminalPanelVisible = true;
      this.terminalPanel.classList.remove('hidden');
      this.switchTerminalTab('ai');
    }
  }

  // Shell Terminal Methods (using xterm.js)
  setupShellTerminal() {
    if (!this.shellTerminalContainer) return;
    // Shell terminal is now part of unified panel - no separate setup needed
  }

  // Get xterm theme from CSS variables
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

  // Helper to detect if a color is light
  isLightColor(color) {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    // Calculate relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
  }

  // Update xterm theme when app theme changes
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
    if (this.state.isTerminalPanelVisible && this.state.activeTerminalTab === 'shell') {
      // Already showing shell terminal, close the panel
      this.state.isTerminalPanelVisible = false;
      this.terminalPanel.classList.add('hidden');
      this.cm.focus();
    } else {
      // Show panel and switch to shell tab
      this.state.isTerminalPanelVisible = true;
      this.terminalPanel.classList.remove('hidden');
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

  async executeClaudeCommand(command) {
    // Get working directory - prefer project root, fall back to current file's directory
    const cwd = this.state.projectRoot || this.state.currentDirectory;

    if (!cwd) {
      this.appendTerminalOutput('Error: No project folder open. Open a folder first with Cmd+Alt+O.', 'error');
      return;
    }

    // Check for /pseudo command
    if (command.trim() === '/pseudo' || command.trim() === '/pseudo doc') {
      await this.pseudonymizeCurrentDoc(cwd);
      return;
    }
    if (command.trim() === '/pseudo all') {
      await this.runPseudonymization(cwd);
      return;
    }

    // Check for /depseudo command - restore original from backup
    if (command === '/depseudo') {
      await this.depseudonymizeCurrentDoc();
      return;
    }

    // Check for /index command - index folder for RAG
    if (command === '/index' || command.startsWith('/index ')) {
      const subpath = command.substring(6).trim();
      const targetPath = subpath ? `${cwd}/${subpath}` : cwd;
      await this.indexFolderForRAG(cwd, targetPath, subpath || null);
      return;
    }

    // Check for /rag command - search with RAG context
    if (command.startsWith('/rag ')) {
      const query = command.substring(5).trim();
      if (query) {
        await this.searchWithRAG(query, cwd);
        return;
      }
    }

    // Check for /agent command - agentic mode with tool calling
    if (command.startsWith('/agent ')) {
      const prompt = command.substring(7).trim();
      if (prompt) {
        await this.executeAgentCommand(prompt, cwd);
        return;
      }
    }

    let finalCommand = command;

    // Check for /doc prefix to include document context
    if (command.startsWith('/doc ')) {
      const docContent = this.getValue();
      const userPrompt = command.substring(5); // Remove '/doc '
      finalCommand = `Here is the document I'm working on:\n\n---\n${docContent}\n---\n\nUser request: ${userPrompt}`;
      this.appendTerminalOutput(`❯ ${userPrompt} (with document context)`, 'input');
    } else {
      this.appendTerminalOutput(`❯ ${command}`, 'input');
    }

    this.state.isClaudeRunning = true;
    this.terminalStop.classList.remove('hidden');

    try {
      await window.vomit.claudeExecute(finalCommand, cwd);
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

  async pseudonymizeCurrentDoc(cwd) {
    this.appendTerminalOutput('❯ /pseudo', 'input');
    this.appendTerminalOutput('Pseudonymizing current document...', 'system');

    const docContent = this.getValue();
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
- Paths with usernames

For each item found, provide a fictional replacement.

OUTPUT: Return ONLY a JSON object mapping original values to fake replacements. No other text.

Example output:
{"Annie de Waard": "Sarah Miller", "jan@company.nl": "user@example.com", "192.168.1.1": "10.0.0.1"}

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
            // Escape special regex characters in the original string
            const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            content = content.replace(new RegExp(escaped, 'g'), replacement);
          }

          // Save the pseudonymized content
          await window.vomit.writeFile(outputPath, content);
          this.appendTerminalOutput(`✓ Saved: ${outputPath.split('/').pop()}`, 'output');

          // Save the mapping
          await window.vomit.writeFile(mappingPath, JSON.stringify(mapping, null, 2));
          this.appendTerminalOutput(`✓ Mapping saved: ${mappingPath.split('/').pop()}`, 'output');

          // Refresh file tree
          this.loadFileTree();
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
      let content = this.cm.getValue();
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
      this.loadFileTree();

      // Check if original file is already open in a tab
      if (this.tabManager) {
        const existingTab = this.tabManager.getTabByPath(originalPath);
        if (existingTab) {
          // Update the tab's content directly
          existingTab.content = content;
          existingTab.isDirty = false;
          // If it's the active tab, update the editor
          if (existingTab.id === this.tabManager.activeTabId) {
            this.cm.setValue(content);
            this.state.isDirty = false;
            this.previewManager.updatePreview();
            this.previewManager.updateStatus();
          }
          this.tabManager.switchToTab(existingTab.id);
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
    this.appendTerminalOutput('❯ /pseudo', 'input');
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
    let remaining = text;

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
    const titleEl = this.terminalPane.querySelector('.terminal-title');
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.editor = new Editor();
});

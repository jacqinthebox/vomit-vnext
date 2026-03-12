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
    this.terminalManager = new TerminalManager({
      state: this.state,
      host: this.host,
      dom: {
        terminalPanel: document.getElementById('terminal-panel'),
        terminalResize: document.getElementById('terminal-resize'),
        terminalClear: document.getElementById('terminal-clear'),
        terminalStop: document.getElementById('terminal-stop'),
        terminalClose: document.getElementById('terminal-close'),
        terminalTabs: document.querySelectorAll('.terminal-tab'),
        aiTerminalContent: document.getElementById('ai-terminal-content'),
        terminalOutput: document.getElementById('terminal-output'),
        terminalInput: document.getElementById('terminal-input'),
        shellTerminalContent: document.getElementById('shell-terminal-content'),
        shellTerminalContainer: document.getElementById('shell-terminal-container')
      },
      getTabManager: () => this.tabManager,
      getPreviewManager: () => this.previewManager,
      getFileTreeManager: () => ({ loadFileTree: () => this.loadFileTree() })
    });

    this.setupAutoSave();
    this.setupSidebarResize();
    this.setupFileTreeContextMenu();
    this.searchManager.setup();
    this.setupKeyboardNavigation();
    this.terminalManager.setupTerminal();
    this.terminalManager.setupShellTerminal();
    this.terminalManager.setupIPC();
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
      this.terminalManager.updateXtermTheme();
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
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.editor = new Editor();
});

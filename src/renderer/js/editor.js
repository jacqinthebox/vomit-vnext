// Editor - Markdown editor with CodeMirror syntax highlighting
class Editor {
  constructor() {
    this.editorContainer = document.getElementById('editor');
    this.preview = document.getElementById('preview');
    this.previewPane = document.getElementById('preview-pane');
    this.statusFile = document.getElementById('status-file');
    this.statusSlides = document.getElementById('status-slides');
    this.statusWords = document.getElementById('status-words');
    this.statusVersion = document.getElementById('status-version');
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
      getFileTreeManager: () => this.fileTreeManager
    });
    this.fileTreeManager = new FileTreeManager({
      state: this.state,
      host: this.host,
      dom: {
        sidebarFiles: this.sidebarFiles,
        sidebarOutline: this.sidebarOutline,
        sidebarSearch: this.sidebarSearch,
        fileTree: this.fileTree,
        sidebarResize: this.sidebarResize
      },
      getTabManager: () => this.tabManager,
      getPreviewManager: () => this.previewManager
    });
    this.settingsManager = new SettingsManager({
      state: this.state,
      host: this.host,
      dom: {
        sidebarResize: this.sidebarResize,
        sidebarFiles: this.sidebarFiles,
        sidebarOutline: this.sidebarOutline,
        sidebarSearch: this.sidebarSearch
      },
      getPreviewManager: () => this.previewManager,
      getSearchManager: () => this.searchManager,
      getTabManager: () => this.tabManager
    });
    this.commandPalette = new CommandPaletteManager({
      host: this.host,
      getEditorActions: () => ({
        tabManager: this.tabManager,
        formatting: this.formatting,
        searchManager: this.searchManager,
        previewManager: this.previewManager,
        fileTreeManager: this.fileTreeManager,
        settingsManager: this.settingsManager,
        getValue: () => this.getValue(),
      })
    });

    this.settingsManager.setupAutoSave();
    this.settingsManager.setupSidebarResize();
    this.fileTreeManager.setupFileTreeContextMenu();
    this.searchManager.setup();
    this.settingsManager.setupKeyboardNavigation();
    this.terminalManager.setupTerminal();
    this.terminalManager.setupShellTerminal();
    this.terminalManager.setupIPC();
    this.setupIPC();

    // Display app version in status bar
    this.displayVersion();

    // Initialize TabManager
    this.tabManager = new TabManager(this);

    // Check if there's a last session to restore - if not, create empty tab
    this.initializeSession();
  }

  async initializeSession() {
    // Bucket auto-opens from main process via open-folder event
    // Create an empty tab initially - it will be replaced when bucket loads
    // or used if no files exist yet
    this.tabManager.createTab(null, '');
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
      this.settingsManager.scheduleAutoSave();
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
        this.fileTreeManager.loadFileTree().then(() => {
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
      this.fileTreeManager.toggleOutline();
    });

    window.addEventListener('vomit:toggle-files', () => {
      this.fileTreeManager.toggleFileTree();
    });

    window.addEventListener('vomit:toggle-word-wrap', () => {
      this.formatting.toggleLineWrapping();
    });

    window.addEventListener('vomit:toggle-line-numbers', () => {
      this.settingsManager.toggleLineNumbers();
    });

    window.addEventListener('vomit:navigate-parent', () => {
      this.fileTreeManager.navigateToParent();
    });

    window.addEventListener('vomit:show-shortcuts', () => {
      this.settingsManager.showShortcutsModal();
    });

    window.addEventListener('vomit:show-documentation', (e) => {
      this.settingsManager.showDocumentation(e.detail.content, e.detail.filePath);
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
      this.fileTreeManager.openFolder(e.detail);
    });

    window.addEventListener('vomit:refresh-file-tree', () => {
      this.fileTreeManager.loadFileTree();
    });

    window.addEventListener('vomit:new-folder', () => {
      this.fileTreeManager.createNewFolder();
    });

    window.addEventListener('vomit:new-file-inline', (e) => {
      const targetDir = e.detail;
      // Set current directory if not set
      if (!this.state.currentDirectory && targetDir) {
        this.state.currentDirectory = targetDir;
      }
      // Show file tree if hidden, then create new file with inline input
      if (!this.state.isFileTreeVisible) {
        this.fileTreeManager.toggleFileTree();
      }
      // Small delay to ensure file tree is rendered before creating input
      // Pass null to let createNewFile use focused folder logic
      setTimeout(() => {
        this.fileTreeManager.createNewFile(null);
      }, 50);
    });

    window.addEventListener('vomit:new-presentation-inline', (e) => {
      const targetDir = e.detail;
      // Set current directory if not set
      if (!this.state.currentDirectory && targetDir) {
        this.state.currentDirectory = targetDir;
      }
      // Show file tree if hidden, then create new presentation with inline input
      if (!this.state.isFileTreeVisible) {
        this.fileTreeManager.toggleFileTree();
      }
      // Small delay to ensure file tree is rendered before creating input
      // Pass null to let createNewPresentation use focused folder logic
      setTimeout(() => {
        this.fileTreeManager.createNewPresentation(null);
      }, 50);
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
      this.commandPalette.showCommandPalette();
    });

    // Bucket switching - clear cache before open-folder arrives
    window.addEventListener('vomit:bucket-switched', (e) => {
      // Clear file tree cache so the new bucket loads fresh
      this.state.expandedFolders.clear();
      this.state.treeCache.clear();

      // The open-folder event will follow and handle:
      // - Closing tabs (via fileTreeManager.openFolder)
      // - Setting projectRoot and currentDirectory
      // - Loading the file tree
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

  async displayVersion() {
    try {
      const version = await window.vomit.getAppVersion();
      if (this.statusVersion) {
        this.statusVersion.textContent = `v${version}`;
      }
    } catch (err) {
      console.error('Failed to get app version:', err);
    }
  }

}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.editor = new Editor();
});

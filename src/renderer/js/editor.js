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
    this.sidebarTags = document.getElementById('sidebar-tags');
    this.sidebarTodos = document.getElementById('sidebar-todos');
    this.outlineList = document.getElementById('outline-list');
    this.rightOutline = document.getElementById('right-outline');
    this.rightOutlineList = document.getElementById('right-outline-list');
    this.fileTree = document.getElementById('file-tree');
    this.searchInput = document.getElementById('search-input');
    this.searchResults = document.getElementById('search-results');
    this.sidebarResize = document.getElementById('sidebar-resize');
    this.rightSidebarResize = document.getElementById('right-sidebar-resize');

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
        sidebarTags: this.sidebarTags,
        sidebarTodos: this.sidebarTodos,
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
        outlineList: this.outlineList,
        rightOutline: this.rightOutline,
        rightOutlineList: this.rightOutlineList,
        rightSidebarResize: this.rightSidebarResize
      }
    });
    this.backlinksManager = new BacklinksManager({
      state: this.state,
      host: this.host,
      dom: {
        rightOutline: this.rightOutline
      }
    });
    this.wikiGraphManager = new WikiGraphManager({
      state: this.state
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
        terminalDetach: document.getElementById('terminal-detach'),
        terminalTabs: document.querySelectorAll('.terminal-tab'),
        aiTerminalContent: document.getElementById('ai-terminal-content'),
        terminalOutput: document.getElementById('terminal-output'),
        terminalInput: document.getElementById('terminal-input'),
        terminalContextBar: document.getElementById('terminal-context-bar'),
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
        sidebarTags: this.sidebarTags,
        sidebarTodos: this.sidebarTodos,
        fileTree: this.fileTree,
        sidebarResize: this.sidebarResize
      },
      getTabManager: () => this.tabManager,
      getPreviewManager: () => this.previewManager
    });
    this.gitBadgesManager = new GitBadgesManager({
      treeView: this.fileTreeManager.treeView,
      dataModel: this.fileTreeManager.dataModel
    });
    this.tagExplorerManager = new TagExplorerManager({
      state: this.state,
      dom: {
        sidebarTags: this.sidebarTags,
        sidebarFiles: this.sidebarFiles,
        sidebarOutline: this.sidebarOutline,
        sidebarSearch: this.sidebarSearch,
        sidebarTodos: this.sidebarTodos,
        sidebarResize: this.sidebarResize,
        tagList: document.getElementById('tag-list')
      }
    });
    this.todoExplorerManager = new TodoExplorerManager({
      state: this.state,
      dom: {
        sidebarTodos: this.sidebarTodos,
        sidebarFiles: this.sidebarFiles,
        sidebarOutline: this.sidebarOutline,
        sidebarSearch: this.sidebarSearch,
        sidebarTags: this.sidebarTags,
        sidebarResize: this.sidebarResize,
        todoList: document.getElementById('todo-list')
      }
    });
    this.settingsManager = new SettingsManager({
      state: this.state,
      host: this.host,
      dom: {
        sidebarResize: this.sidebarResize,
        sidebarFiles: this.sidebarFiles,
        sidebarOutline: this.sidebarOutline,
        sidebarSearch: this.sidebarSearch,
        sidebarTags: this.sidebarTags,
        sidebarTodos: this.sidebarTodos,
        rightSidebarResize: this.rightSidebarResize,
        rightOutline: this.rightOutline
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
        tagExplorerManager: this.tagExplorerManager,
        todoExplorerManager: this.todoExplorerManager,
        settingsManager: this.settingsManager,
        terminalManager: this.terminalManager,
        wikiGraphManager: this.wikiGraphManager,
        getValue: () => this.getValue(),
      })
    });
    this.inlineImages = new InlineImageManager({
      state: this.state,
      host: this.host
    });
    this.inlineImages.setup();

    this.settingsManager.setupAutoSave();
    this.settingsManager.setupSidebarResize();
    this.settingsManager.setupRightSidebarResize();
    this.fileTreeManager.setupFileTreeContextMenu();
    this.searchManager.setup();
    this.settingsManager.setupKeyboardNavigation();
    this.terminalManager.setupTerminal();
    this.terminalManager.setupShellTerminal();
    this.terminalManager.setupIPC();
    this.terminalManager._setupDetachedContextSync();
    this.setupIPC();
    this.setupMultiCursor();
    this._attachWikilinkAutocomplete();

    // Display app version in status bar
    this.displayVersion();

    // Initialize TabManager
    this.tabManager = new TabManager(this);

    // Check if there's a last session to restore - if not, create empty tab
    this.initializeSession();
  }

  async initializeSession() {
    // Load and apply saved font size
    await this.loadFontSize();

    // Load sort order preference
    try {
      const sortOrder = await window.vomit.getFileSortOrder();
      if (sortOrder) {
        this.fileTreeManager.dataModel.sortOrder = sortOrder;
      }
    } catch (err) {}

    // Bucket auto-opens from main process via open-folder event
    // Create an empty tab initially - it will be replaced when bucket loads
    // or used if no files exist yet
    this.tabManager.createTab(null, '');

    // File tree is visible by default — ensure it loads once a root is available
    if (this.state.isFileTreeVisible) {
      this.fileTreeManager.loadFileTree();
    }
  }

  async loadFontSize() {
    try {
      const fontSize = await window.vomit.getFontSize();
      if (fontSize) {
        this.applyFontSize(fontSize);
      }
    } catch (err) {
      // Ignore errors, use default
    }
  }

  applyFontSize(size) {
    // Set CSS variable
    document.documentElement.style.setProperty('--editor-font-size', `${size}px`);

    // Refresh CodeMirror to pick up the new size
    this.cm.refresh();
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
        'Cmd-M': () => this.formatting.wrapCodeBlock(),
        'Ctrl-M': () => this.formatting.wrapCodeBlock(),
        'Cmd-K': () => this.formatting.insertLink(),
        'Ctrl-K': () => this.formatting.insertLink(),
        'Shift-Cmd-T': () => this.formatting.formatTable(),
        'Shift-Ctrl-T': () => this.formatting.formatTable(),
        'Shift-Cmd-Enter': () => this.formatting.toggleTodoLine(),
        'Shift-Ctrl-Enter': () => this.formatting.toggleTodoLine(),
        'Alt-Z': () => this.formatting.toggleLineWrapping(),
        'Ctrl-J': (cm) => this.showHints(cm),
        'Ctrl-Space': (cm) => this.showHints(cm)
      },
      placeholder: '# Start writing your presentation...\n\nUse --- on its own line to separate slides.\n\nAdd speaker notes after ??? on a slide.'
    });
    this.cm = this.host.cm;  // Backward compat alias

    // Git change indicators in the editor gutter (inert outside a git repo)
    this.gitGutterManager = new GitGutterManager({ host: this.host, state: this.state });

    // Handle changes
    this.cm.on('change', () => {
      this.host.updateCodeBlockStyles();
      this.previewManager.updatePreview();
      this.previewManager.updateStatus();
      this.previewManager.updateOutline();
      this.previewManager.updateRightOutline();

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

    // Paste handling - smart detection for markdown vs rich text
    this.cm.on('paste', async (cm, e) => {
      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      // Get both plain text and HTML first
      const plainText = clipboardData.getData('text/plain');
      const htmlText = clipboardData.getData('text/html');

      // If we have text, handle it (Word/browser/markdown)
      if (plainText) {
        // Continue with text handling below
      } else {
        // No text available, check for images only
        const items = clipboardData.items;
        if (items) {
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
                  this.formatting.insertText(`![](${imagePath} =800x)`);
                }
              };
              reader.readAsDataURL(blob);
              return; // Exit early for images
            }
          }
        }
        return; // No text and no image, nothing to paste
      }

      // Strategy:
      // 1. If plain text already has markdown syntax → use it as-is (markdown source)
      // 2. If plain text has no markdown but HTML has links → convert HTML to markdown (browser)
      // 3. Otherwise → use plain text (Word/rich text)

      let textToInsert = plainText;

      // Check if plain text already contains markdown
      const hasMarkdown = /\[.+?\]\(.+?\)|\*\*.+?\*\*|__.+?__|^#{1,6}\s|```/m.test(plainText);

      if (!hasMarkdown && htmlText) {
        // Plain text has no markdown, but we have HTML
        // Check if HTML contains links (common in browser copies)
        if (/<a\s+href=/i.test(htmlText)) {
          // Convert HTML links to markdown
          textToInsert = this._extractLinksFromHtml(htmlText, plainText);
        }
        // For other HTML (Word, etc) we just use plain text (already set)
      }

      e.preventDefault();
      // Replace the selection (all of them, with multi-cursor) rather than
      // inserting at the cursor next to still-selected text.
      cm.getDoc().replaceSelection(textToInsert);
    });

    // Cmd/Ctrl + click on [[wikilink]] opens the target file.
    this.cm.getWrapperElement().addEventListener('mousedown', (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.button !== 0) return;

      const pos = this.cm.coordsChar({ left: e.clientX, top: e.clientY });
      if (!pos) return;

      const line = this.cm.getLine(pos.line);
      if (!line || line.indexOf('[[') === -1) return;

      // Find the [[...]] span that contains pos.ch
      const re = /\[\[([^\[\]\n]+?)\]\]/g;
      let m;
      while ((m = re.exec(line)) !== null) {
        const start = m.index;
        const end = m.index + m[0].length;
        if (pos.ch >= start && pos.ch <= end) {
          e.preventDefault();
          e.stopPropagation();
          // The text inside [[ ]] may include an alias (|) — strip it before resolving.
          const raw = m[1];
          const pipeIdx = raw.indexOf('|');
          const target = (pipeIdx === -1 ? raw : raw.substring(0, pipeIdx)).trim();
          this._openWikilink(target);
          return;
        }
      }
    });

    // Clicking a rendered [[wikilink]] in the preview pane opens the target too.
    window.addEventListener('vomit:open-wikilink', (e) => {
      if (e.detail) this._openWikilink(e.detail);
    });

    // Align all markdown tables on request (e.g. after an AI write command).
    window.addEventListener('vomit:format-tables', () => {
      if (this.formatting) this.formatting.formatAllTables();
    });
  }

  async _openWikilink(target) {
    const bucketRoot = this.state.projectRoot || this.state.currentDirectory;
    if (!bucketRoot) return;
    try {
      const result = await window.vomit.wikiResolve(bucketRoot, target, this.state.currentFilePath || null);
      if (result && result.success && result.path) {
        window.vomit.openFile(result.path);
        return;
      }
      // Broken link — prompt to create a sibling note with this basename.
      await this._promptCreateNote(bucketRoot, target);
    } catch {
      // ignore
    }
  }

  async _promptCreateNote(bucketRoot, target) {
    // Strip alias/heading from the target before using it as a filename.
    const cleaned = target.split('|')[0].split('#')[0].trim();
    if (!cleaned) return;

    const sanitized = cleaned.replace(/[\\:*?"<>]/g, '').trim();
    const willCreate = window.confirm(
      `"${sanitized}" does not exist yet.\nCreate it now?`
    );
    if (!willCreate) return;

    // Place the new note next to the current file when possible, else at the
    // bucket root.
    const currentFile = this.state.currentFilePath;
    let baseDir = bucketRoot;
    if (currentFile && currentFile.startsWith(bucketRoot)) {
      const sep = currentFile.includes('\\') ? '\\' : '/';
      const idx = currentFile.lastIndexOf(sep);
      if (idx > -1) baseDir = currentFile.substring(0, idx);
    }

    const sep = baseDir.includes('\\') ? '\\' : '/';
    const filename = sanitized.endsWith('.md') ? sanitized : `${sanitized}.md`;
    const newPath = `${baseDir}${sep}${filename}`;

    const stub = `# ${sanitized}\n\n`;
    try {
      await window.vomit.writeFile(newPath, stub);
      window.vomit.openFile(newPath);
    } catch (err) {
      window.alert(`Failed to create note: ${err.message || err}`);
    }
  }

  _attachWikilinkAutocomplete() {
    if (!window.VomitWikilinkHint) return;
    window.VomitWikilinkHint.attachWikilinkHint(this.cm, () =>
      this.state.projectRoot || this.state.currentDirectory
    );
  }

  // Extract links from HTML and convert to markdown, preserving plain text structure
  _extractLinksFromHtml(html, plainText) {
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // Build a map of link text → URL
    const linkMap = new Map();
    temp.querySelectorAll('a[href]').forEach(a => {
      const text = a.textContent.trim();
      const href = a.getAttribute('href');
      if (text && href) {
        linkMap.set(text, href);
      }
    });

    // Replace link texts in plain text with markdown links
    let result = plainText;
    linkMap.forEach((url, text) => {
      // Use a more precise regex to avoid replacing partial matches
      const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedText}\\b`, 'g');
      result = result.replace(regex, `[${text}](${url})`);
    });

    return result;
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
          // Still handle pending line jump for search results
          if (this.state.pendingLineJump) {
            setTimeout(() => {
              const lineIndex = this.state.pendingLineJump - 1;
              const query = this.state.pendingSearchQuery;

              if (query) {
                const lineContent = this.host.getLine(lineIndex);
                if (lineContent) {
                  const lowerLine = lineContent.toLowerCase();
                  const lowerQuery = query.toLowerCase();
                  const matchStart = lowerLine.indexOf(lowerQuery);
                  if (matchStart >= 0) {
                    const matchEnd = matchStart + query.length;
                    this.host.setSelection(
                      { line: lineIndex, ch: matchStart },
                      { line: lineIndex, ch: matchEnd }
                    );
                    this.host.scrollIntoView({ line: lineIndex, ch: matchStart });
                  } else {
                    this.previewManager.goToLine(lineIndex);
                  }
                }
                this.state.pendingSearchQuery = null;
              } else {
                this.previewManager.goToLine(lineIndex);
              }
              this.state.pendingLineJump = null;
            }, 50);
          }
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

      // Viewer files are rendered during tab restore.
      if (this.previewManager.isViewerFile()) {
        if (this.state.isFileTreeVisible) {
          this.fileTreeManager.loadFileTree();
        }
        return;
      }

      // Exit viewer mode if previously active
      if (this.state._isViewerMode) {
        this.previewManager.exitViewerMode();
      }

      this.cm.setOption('filename', filePath); // For hints file-type detection
      this.previewManager.updateEditorMode();
      this.previewManager.applyFrontmatterSettings(content);

      if (this.state.isOutlineVisible) {
        this.previewManager.updateOutline();
      }
      if (this.state.isRightOutlineVisible) {
        this.previewManager.updateRightOutline();
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
          const lineIndex = this.state.pendingLineJump - 1;
          const query = this.state.pendingSearchQuery;

          if (query) {
            // Highlight the search term on the line
            const lineContent = this.host.getLine(lineIndex);
            if (lineContent) {
              const lowerLine = lineContent.toLowerCase();
              const lowerQuery = query.toLowerCase();
              const matchStart = lowerLine.indexOf(lowerQuery);
              if (matchStart >= 0) {
                const matchEnd = matchStart + query.length;
                this.host.setSelection(
                  { line: lineIndex, ch: matchStart },
                  { line: lineIndex, ch: matchEnd }
                );
                this.host.scrollIntoView({ line: lineIndex, ch: matchStart });
              } else {
                this.previewManager.goToLine(lineIndex);
              }
            }
            this.state.pendingSearchQuery = null;
          } else {
            this.previewManager.goToLine(lineIndex);
          }

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

    window.addEventListener('vomit:close-other-tabs', () => {
      this.tabManager.closeOtherTabs();
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
      this.state.basePath = filePath ? window.PathUtils.dirname(filePath) : null;
      if (this.tabManager) {
        this.tabManager.updateCurrentTabPath(filePath);
      }
      this.todoExplorerManager.scheduleLoad();
    });

    window.addEventListener('vomit:file-saved', (e) => {
      // Update tab path after Save As
      const { filePath } = e.detail || {};
      if (filePath && this.tabManager) {
        this.tabManager.updateCurrentTabPath(filePath);
        this.tabManager.markCurrentTabClean();
      }
      this.todoExplorerManager.scheduleLoad();
    });

    window.addEventListener('vomit:toggle-preview', () => {
      this.previewManager.togglePreview();
    });

    window.addEventListener('vomit:toggle-outline', () => {
      this.fileTreeManager.toggleOutline();
    });

    window.addEventListener('vomit:toggle-right-outline', () => {
      this.previewManager.toggleRightOutline();
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

    window.addEventListener('vomit:toggle-tags', () => {
      this.tagExplorerManager.toggleTagExplorer();
    });

    window.addEventListener('vomit:toggle-todos', () => {
      this.todoExplorerManager.toggleTodoExplorer();
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

    window.addEventListener('vomit:refresh-file-tree', (e) => {
      const projectRoot = this.state.projectRoot || this.state.currentDirectory;
      const { changedPath, deletedPath } = e.detail || {};

      // Purge stale subtree cache for deleted directories
      if (deletedPath) {
        this.fileTreeManager.invalidateDirectory(deletedPath);
      }

      // Refresh the most specific changed folder, or fall back to root
      const normalRoot = projectRoot ? window.PathUtils.normalize(projectRoot).replace(/\/$/, '') : null;
      const isInsideProject = normalRoot && changedPath &&
        window.PathUtils.isSubPath(changedPath, normalRoot);
      const target = isInsideProject ? changedPath : projectRoot;

      if (target) {
        this.fileTreeManager.refreshFolder(target);
      } else {
        this.fileTreeManager.loadFileTree();
      }
    });

    window.addEventListener('vomit:sort-order-changed', (e) => {
      this.fileTreeManager.dataModel.sortOrder = e.detail;
      this.fileTreeManager.openFolder(
        this.state.projectRoot || this.state.currentDirectory
      );
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
        case 'codeBlock': this.formatting.wrapCodeBlock(); break;
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
        case 'todo': this.formatting.toggleTodoLine(); break;
        case 'dateHeading': this.formatting.insertDateHeading(); break;
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

    window.addEventListener('vomit:font-size-changed', (e) => {
      this.applyFontSize(e.detail);
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

    // File opened outside bucket notification
    window.addEventListener('vomit:file-outside-bucket', (e) => {
      const filePath = e.detail;
      const fileName = window.PathUtils.basename(filePath);
      this.showToast(`⚠ Opened "${fileName}" (outside bucket)`, 'warning', 5000);
    });

    // Update available notification
    window.addEventListener('vomit:update-available', (e) => {
      const { current, latest } = e.detail;
      this.showToast(`Update available: v${latest} (current: v${current})`, 'info', 8000);
    });

  }

  showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }

  async handleExternalFileChange(tab) {
    const filePath = tab ? tab.filePath : this.state.currentFilePath;
    const isDirty = tab ? tab.isDirty : this.state.isDirty;
    const filename = filePath ? window.PathUtils.basename(filePath) : 'file';

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

  setupMultiCursor() {
    // PyCharm-style multi-cursor: double-tap Option + arrow keys
    const DOUBLE_TAP_MS = 300;
    let lastOptionTime = 0;
    let multiCursorMode = false;

    document.addEventListener('keydown', (e) => {
      // Detect double-tap of Option (Alt) key
      if (e.key === 'Alt' && !e.repeat) {
        const now = Date.now();
        if (now - lastOptionTime < DOUBLE_TAP_MS) {
          multiCursorMode = true;
        }
        lastOptionTime = now;
        return;
      }

      // Handle arrow keys when in multi-cursor mode with Option held
      if (multiCursorMode && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          this.host.addCursorAbove();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          this.host.addCursorBelow();
          return;
        }
      }

      // Escape clears extra cursors
      if (e.key === 'Escape') {
        const selections = this.host.listSelections();
        if (selections.length > 1) {
          e.preventDefault();
          this.host.clearExtraCursors();
          multiCursorMode = false;
        }
      }

      // Any non-modifier key exits multi-cursor mode (but keeps cursors)
      if (!['Alt', 'Control', 'Shift', 'Meta', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        multiCursorMode = false;
      }
    });

    document.addEventListener('keyup', (e) => {
      // Exit multi-cursor mode when Option is released
      if (e.key === 'Alt') {
        multiCursorMode = false;
      }
    });
  }

}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.editor = new Editor();
});

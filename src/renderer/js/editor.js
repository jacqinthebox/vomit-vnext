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

    this.currentFilePath = null;
    this.basePath = null;
    this.currentDirectory = null;
    this.isPreviewVisible = true;
    this.isFileTreeVisible = false;
    this.isOutlineVisible = false;
    this.isSearchVisible = false;
    this.isDirty = false;
    this.searchTimeout = null;
    this.autoSaveTimeout = null;
    this.pendingLineJump = null;
    this.selectedSearchIndex = -1;
    this.focusedPane = 'editor'; // 'editor' or 'sidebar'

    this.setupEditor();
    this.setupAutoSave();
    this.setupSidebarResize();
    this.setupSearch();
    this.setupKeyboardNavigation();
    this.setupIPC();
    this.togglePreview(); // Start with preview visible
  }

  setupEditor() {
    // Initialize CodeMirror
    this.cm = CodeMirror(this.editorContainer, {
      mode: 'yaml-frontmatter',  // GFM with YAML frontmatter support
      theme: 'default',
      lineNumbers: false,
      lineWrapping: true,
      autofocus: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      extraKeys: {
        'Tab': (cm) => {
          cm.replaceSelection('  ');
        },
        'Cmd-B': () => this.wrapSelection('**', '**'),
        'Ctrl-B': () => this.wrapSelection('**', '**'),
        'Cmd-I': () => this.wrapSelection('*', '*'),
        'Ctrl-I': () => this.wrapSelection('*', '*'),
        'Cmd-`': () => this.wrapSelection('`', '`'),
        'Ctrl-`': () => this.wrapSelection('`', '`'),
        'Cmd-K': () => this.insertLink(),
        'Ctrl-K': () => this.insertLink(),
        'Ctrl-J': (cm) => this.showHints(cm),
        'Ctrl-Space': (cm) => this.showHints(cm)
      },
      placeholder: '# Start writing your presentation...\n\nUse --- on its own line to separate slides.\n\nAdd speaker notes after ??? on a slide.'
    });

    // Handle changes
    this.cm.on('change', () => {
      this.updatePreview();
      this.updateStatus();
      this.updateOutline();
      this.isDirty = true;
      window.vomit.contentChanged(this.getValue());

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
              this.insertText(`![](${imagePath} =400x)`);
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
      this.currentFilePath = filePath;
      this.cm.setOption('filename', filePath); // For hints file-type detection
      this.updateEditorMode();
      this.setValue(content);
      this.applyFrontmatterSettings(content);
      this.basePath = basePath;
      this.currentDirectory = basePath;
      this.isDirty = false;
      this.updatePreview();
      this.updateStatus();
      if (this.isOutlineVisible) {
        this.updateOutline();
      }
      if (this.isFileTreeVisible) {
        const preserveFocus = this.focusedPane === 'sidebar';
        this.loadFileTree().then(() => {
          if (preserveFocus) {
            // Re-focus the active file after tree re-renders
            const activeItem = this.fileTree.querySelector('.file-item.active');
            if (activeItem) activeItem.focus();
          }
        });
      }
      // Handle pending line jump from search
      if (this.pendingLineJump) {
        setTimeout(() => {
          this.goToLine(this.pendingLineJump - 1); // Convert to 0-based
          this.pendingLineJump = null;
        }, 100);
      }
    });

    window.addEventListener('vomit:request-content', () => {
      window.vomit.saveContent(this.getValue());
      this.isDirty = false;
    });

    window.addEventListener('vomit:toggle-preview', () => {
      this.togglePreview();
    });

    window.addEventListener('vomit:toggle-outline', () => {
      this.toggleOutline();
    });

    window.addEventListener('vomit:toggle-files', () => {
      this.toggleFileTree();
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

    window.addEventListener('vomit:toggle-search', () => {
      this.toggleSearch();
    });

    window.addEventListener('vomit:find-in-file', () => {
      // Trigger CodeMirror's built-in find dialog
      this.cm.execCommand('find');
    });

    window.addEventListener('vomit:open-folder', (e) => {
      this.openFolder(e.detail);
    });

    window.addEventListener('vomit:format-command', (e) => {
      const command = e.detail;
      switch (command) {
        case 'bold': this.wrapSelection('**', '**'); break;
        case 'italic': this.wrapSelection('*', '*'); break;
        case 'code': this.wrapSelection('`', '`'); break;
        case 'link': this.insertLink(); break;
        case 'table': this.insertTable(); break;
        case 'h1': this.insertAtLineStart('# '); break;
        case 'h2': this.insertAtLineStart('## '); break;
        case 'h3': this.insertAtLineStart('### '); break;
        case 'bullet': this.insertAtLineStart('- '); break;
        case 'quote': this.insertAtLineStart('> '); break;
        case 'hr': this.insertText('\n---\n'); break;
        case 'slide': this.insertSlide(); break;
      }
    });

    window.addEventListener('vomit:set-theme', (e) => {
      document.body.className = `theme-${e.detail}`;
      if (this.isPreviewVisible) {
        document.body.classList.add('split-view');
      }
    });
  }

  toggleFileTree() {
    this.isFileTreeVisible = !this.isFileTreeVisible;
    this.sidebarFiles.classList.toggle('hidden', !this.isFileTreeVisible);
    this.updateResizeHandle();
    if (this.isFileTreeVisible) {
      // Close other sidebars
      this.isOutlineVisible = false;
      this.isSearchVisible = false;
      this.sidebarOutline.classList.add('hidden');
      this.sidebarSearch.classList.add('hidden');
      this.focusedPane = 'sidebar';
      this.loadFileTree().then(() => {
        const firstItem = this.fileTree.querySelector('.file-item');
        if (firstItem) firstItem.focus();
      });
    } else {
      // Return focus to editor when hiding
      this.focusedPane = 'editor';
      this.cm.focus();
    }
  }

  toggleOutline() {
    this.isOutlineVisible = !this.isOutlineVisible;
    this.sidebarOutline.classList.toggle('hidden', !this.isOutlineVisible);
    this.updateResizeHandle();
    if (this.isOutlineVisible) {
      // Close other sidebars
      this.isFileTreeVisible = false;
      this.isSearchVisible = false;
      this.sidebarFiles.classList.add('hidden');
      this.sidebarSearch.classList.add('hidden');
      this.updateOutline();
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
            <h3>File</h3>
            <div class="shortcut-row"><kbd>Cmd+N</kbd> New file</div>
            <div class="shortcut-row"><kbd>Cmd+O</kbd> Open file</div>
            <div class="shortcut-row"><kbd>Cmd+S</kbd> Save</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+S</kbd> Save as</div>
          </div>
          <div class="shortcuts-section">
            <h3>View</h3>
            <div class="shortcut-row"><kbd>Cmd+P</kbd> Toggle preview</div>
            <div class="shortcut-row"><kbd>Cmd+E</kbd> Toggle explorer</div>
            <div class="shortcut-row"><kbd>Cmd+L</kbd> Toggle line numbers</div>
            <div class="shortcut-row"><kbd>Cmd+F</kbd> Find in file</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+F</kbd> Search in files</div>
            <div class="shortcut-row"><kbd>Cmd+/</kbd> Show shortcuts</div>
          </div>
          <div class="shortcuts-section">
            <h3>Format</h3>
            <div class="shortcut-row"><kbd>Cmd+B</kbd> Bold</div>
            <div class="shortcut-row"><kbd>Cmd+I</kbd> Italic</div>
            <div class="shortcut-row"><kbd>Cmd+K</kbd> Insert link</div>
            <div class="shortcut-row"><kbd>Cmd+T</kbd> Insert table</div>
            <div class="shortcut-row"><kbd>Cmd+1/2/3</kbd> Headings</div>
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

  navigateToParent() {
    if (!this.currentDirectory) return;
    const parts = this.currentDirectory.split('/');
    if (parts.length > 2) {
      parts.pop();
      this.currentDirectory = parts.join('/');
      this.loadFileTree().then(() => {
        // Focus first item after navigating up
        const firstItem = this.fileTree.querySelector('.file-item');
        if (firstItem) firstItem.focus();
      });
    }
  }

  openFolder(folderPath) {
    this.currentDirectory = folderPath;
    // Show file tree sidebar
    this.isFileTreeVisible = true;
    this.isOutlineVisible = false;
    this.isSearchVisible = false;
    this.sidebarFiles.classList.remove('hidden');
    this.sidebarOutline.classList.add('hidden');
    this.sidebarSearch.classList.add('hidden');
    this.updateResizeHandle();
    this.loadFileTree();
  }

  setupSearch() {
    // Debounced search on input
    this.searchInput.addEventListener('input', () => {
      clearTimeout(this.searchTimeout);
      this.selectedSearchIndex = -1;
      this.searchTimeout = setTimeout(() => this.performSearch(), 300);
    });

    // Keyboard navigation in search
    this.searchInput.addEventListener('keydown', (e) => {
      const items = this.searchResults.querySelectorAll('.search-result-item');

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectedSearchIndex = Math.min(this.selectedSearchIndex + 1, items.length - 1);
        this.updateSearchSelection(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectedSearchIndex = Math.max(this.selectedSearchIndex - 1, -1);
        this.updateSearchSelection(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.selectedSearchIndex >= 0 && items[this.selectedSearchIndex]) {
          items[this.selectedSearchIndex].click();
        } else {
          clearTimeout(this.searchTimeout);
          this.performSearch();
        }
      } else if (e.key === 'Escape') {
        this.toggleSearch();
        this.cm.focus();
      }
    });
  }

  updateSearchSelection(items) {
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === this.selectedSearchIndex);
    });
    if (this.selectedSearchIndex >= 0 && items[this.selectedSearchIndex]) {
      items[this.selectedSearchIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  setupKeyboardNavigation() {
    // Ctrl+W or Ctrl+Tab to toggle focus between editor and sidebar
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && (e.key === 'w' || e.key === 'Tab')) {
        e.preventDefault();
        this.togglePaneFocus();
      }
    });
  }

  setupAutoSave() {
    // Save when window loses focus
    window.addEventListener('blur', () => {
      if (this.isDirty && this.currentFilePath) {
        this.autoSave();
      }
    });

    // Save before closing/navigating away
    window.addEventListener('beforeunload', (e) => {
      if (this.isDirty && this.currentFilePath) {
        this.autoSave();
      }
    });
  }

  scheduleAutoSave() {
    // Only auto-save if file has been saved before (has a path)
    if (!this.currentFilePath) return;

    // Clear existing timeout
    clearTimeout(this.autoSaveTimeout);

    // Schedule save for 2 seconds after last change
    this.autoSaveTimeout = setTimeout(() => {
      if (this.isDirty) {
        this.autoSave();
      }
    }, 2000);
  }

  autoSave() {
    if (!this.isDirty || !this.currentFilePath) return;

    window.vomit.saveContent(this.getValue());
    this.isDirty = false;
    this.updateStatus();
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
      if (this.isFileTreeVisible) currentSidebar = this.sidebarFiles;
      else if (this.isOutlineVisible) currentSidebar = this.sidebarOutline;
      else if (this.isSearchVisible) currentSidebar = this.sidebarSearch;
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

  updateResizeHandle() {
    const anySidebarVisible = this.isFileTreeVisible || this.isOutlineVisible || this.isSearchVisible;
    this.sidebarResize.classList.toggle('hidden', !anySidebarVisible);
  }

  togglePaneFocus() {
    const anySidebarOpen = this.isFileTreeVisible || this.isOutlineVisible || this.isSearchVisible;

    if (!anySidebarOpen) {
      // No sidebar open, stay in editor
      this.cm.focus();
      return;
    }

    if (this.focusedPane === 'editor') {
      // Move focus to sidebar
      this.focusedPane = 'sidebar';
      if (this.isSearchVisible) {
        this.searchInput.focus();
      } else if (this.isFileTreeVisible) {
        const firstItem = this.fileTree.querySelector('.file-item');
        if (firstItem) firstItem.focus();
      } else if (this.isOutlineVisible) {
        const firstItem = this.outlineList.querySelector('.outline-item');
        if (firstItem) firstItem.focus();
      }
    } else {
      // Move focus back to editor
      this.focusedPane = 'editor';
      this.cm.focus();
    }
  }

  toggleSearch() {
    this.isSearchVisible = !this.isSearchVisible;
    this.sidebarSearch.classList.toggle('hidden', !this.isSearchVisible);
    this.updateResizeHandle();
    if (this.isSearchVisible) {
      // Close other sidebars
      this.isFileTreeVisible = false;
      this.isOutlineVisible = false;
      this.sidebarFiles.classList.add('hidden');
      this.sidebarOutline.classList.add('hidden');
      // Focus the search input
      this.searchInput.focus();
    }
  }

  async performSearch() {
    const query = this.searchInput.value.trim();
    if (!query || query.length < 2) {
      this.searchResults.innerHTML = '<div class="search-no-results">Type at least 2 characters to search</div>';
      return;
    }

    if (!this.currentDirectory) {
      this.currentDirectory = await window.vomit.getCurrentDirectory();
    }

    if (!this.currentDirectory) {
      this.searchResults.innerHTML = '<div class="search-no-results">Open a file to search in its directory</div>';
      return;
    }

    const results = await window.vomit.searchInFiles(this.currentDirectory, query);
    this.renderSearchResults(results, query);
  }

  renderSearchResults(results, query) {
    this.selectedSearchIndex = -1;

    if (!results || results.length === 0) {
      this.searchResults.innerHTML = '<div class="search-no-results">No results found</div>';
      return;
    }

    const html = results.map(file => {
      const matchesHtml = file.matches.map(match => {
        // Highlight the matching text
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const highlightedText = match.text.replace(
          new RegExp(`(${escapedQuery})`, 'gi'),
          '<span class="match">$1</span>'
        );
        return `<div class="search-result-item" data-path="${file.path}" data-line="${match.line}">
          <span class="line-number">${match.line}:</span>${highlightedText}
        </div>`;
      }).join('');

      return `<div class="search-result-file">${file.file}</div>${matchesHtml}`;
    }).join('');

    this.searchResults.innerHTML = html;

    // Add click handlers
    this.searchResults.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const filePath = el.dataset.path;
        const line = parseInt(el.dataset.line, 10);
        window.vomit.openFile(filePath);
        // After file loads, jump to line (handled via event)
        this.pendingLineJump = line;
      });
    });
  }

  async loadFileTree() {
    if (!this.currentDirectory) {
      // Try to get current directory from main process
      this.currentDirectory = await window.vomit.getCurrentDirectory();
    }

    if (!this.currentDirectory) {
      this.fileTree.innerHTML = '<div class="file-item" style="color: var(--text-muted); padding: 16px;">Open a file to see its directory</div>';
      return;
    }

    const items = await window.vomit.getDirectoryContents(this.currentDirectory);
    this.renderFileTree(items);
  }

  renderFileTree(items) {
    if (!items || items.length === 0) {
      this.fileTree.innerHTML = '<div class="file-item empty-message" style="color: var(--text-muted);">Empty folder</div>';
    } else {
      this.fileTree.innerHTML = items.map((item, index) => {
      const isActive = item.path === this.currentFilePath;
      const typeClass = item.isDirectory ? 'directory' : (item.isMarkdown ? 'markdown' : 'file');
      const activeClass = isActive ? 'active' : '';

      return `<div class="file-item ${typeClass} ${activeClass}" data-path="${item.path}" data-is-dir="${item.isDirectory}" tabindex="0">
        <span class="icon"></span>
        <span class="name">${item.name}</span>
      </div>`;
    }).join('');

    // Add click and keyboard handlers
    this.fileTree.querySelectorAll('.file-item').forEach(el => {
      const handleAction = () => {
        const filePath = el.dataset.path;
        const isDir = el.dataset.isDir === 'true';

        if (isDir) {
          this.currentDirectory = filePath;
          this.loadFileTree().then(() => {
            const firstItem = this.fileTree.querySelector('.file-item');
            if (firstItem) firstItem.focus();
          });
        } else {
          // Update active state for preview
          this.fileTree.querySelectorAll('.file-item.active').forEach(item => item.classList.remove('active'));
          el.classList.add('active');
          // Mark that focus should stay in sidebar
          this.focusedPane = 'sidebar';
          window.vomit.openFile(filePath);
        }
      };

      el.addEventListener('click', handleAction);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleAction();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = el.nextElementSibling;
          if (next && next.classList.contains('file-item')) next.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = el.previousElementSibling;
          if (prev && prev.classList.contains('file-item')) prev.focus();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          const isDir = el.dataset.isDir === 'true';
          if (isDir) {
            handleAction(); // Enter folder
          }
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.navigateToParent();
        } else if (e.key === 'Escape') {
          this.cm.focus();
          this.focusedPane = 'editor';
        }
      });

      // Context menu for rename, delete, show in finder
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showFileContextMenu(el, e.clientX, e.clientY);
      });
    });
    }

    // Add parent directory item if not at root
    const parentItem = document.createElement('div');
    parentItem.className = 'file-item directory parent-dir';
    parentItem.tabIndex = 0;
    parentItem.innerHTML = '<span class="icon"></span><span class="name">..</span>';

    const goUp = () => {
      const parts = this.currentDirectory.split('/');
      if (parts.length > 2) {
        parts.pop();
        this.currentDirectory = parts.join('/');
        this.loadFileTree().then(() => {
          const firstItem = this.fileTree.querySelector('.file-item');
          if (firstItem) firstItem.focus();
        });
      }
    };
    parentItem.addEventListener('click', goUp);
    parentItem.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        goUp();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = parentItem.nextElementSibling;
        if (next && next.classList.contains('file-item')) next.focus();
      } else if (e.key === 'Escape') {
        this.cm.focus();
        this.focusedPane = 'editor';
      }
    });
    this.fileTree.insertBefore(parentItem, this.fileTree.firstChild);
  }

  wrapSelection(before, after) {
    const selection = this.cm.getSelection();
    this.cm.replaceSelection(before + selection + after);

    if (!selection) {
      // Move cursor between the markers
      const cursor = this.cm.getCursor();
      this.cm.setCursor({ line: cursor.line, ch: cursor.ch - after.length });
    }
    this.cm.focus();
    this.updatePreview();
  }

  insertAtLineStart(prefix) {
    const cursor = this.cm.getCursor();
    const line = cursor.line;
    const lineContent = this.cm.getLine(line);

    this.cm.replaceRange(prefix, { line: line, ch: 0 }, { line: line, ch: 0 });
    this.cm.setCursor({ line: line, ch: prefix.length + cursor.ch });
    this.cm.focus();
    this.updatePreview();
  }

  insertText(text) {
    this.cm.replaceSelection(text);
    this.cm.focus();
    this.updatePreview();
  }

  insertLink() {
    const selection = this.cm.getSelection();
    const linkText = selection || 'link text';
    const link = `[${linkText}](url)`;

    this.cm.replaceSelection(link);

    // Select 'url' part
    const cursor = this.cm.getCursor();
    const urlStart = cursor.ch - 4;
    this.cm.setSelection(
      { line: cursor.line, ch: urlStart },
      { line: cursor.line, ch: urlStart + 3 }
    );
    this.cm.focus();
    this.updatePreview();
  }

  insertSlide() {
    const slideTemplate = '\n\n---\n\n# New Slide\n\nContent here\n\n???\nSpeaker notes here\n';
    this.cm.replaceSelection(slideTemplate);
    this.cm.focus();
    this.updatePreview();
  }

  insertTable() {
    const tableTemplate = `
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
`;
    this.cm.replaceSelection(tableTemplate);
    this.cm.focus();
    this.updatePreview();
  }

  togglePreview() {
    this.isPreviewVisible = !this.isPreviewVisible;
    this.previewPane.classList.toggle('visible', this.isPreviewVisible);
    document.body.classList.toggle('split-view', this.isPreviewVisible);

    if (this.isPreviewVisible) {
      this.updatePreview();
    }
  }

  isMarkdownFile() {
    if (!this.currentFilePath) return true; // Default to markdown for new files
    const ext = this.currentFilePath.split('.').pop().toLowerCase();
    return ['md', 'markdown'].includes(ext);
  }

  parseFrontmatter(content) {
    if (!content.startsWith('---')) return {};

    const endIndex = content.indexOf('---', 3);
    if (endIndex === -1) return {};

    const frontmatter = content.substring(3, endIndex).trim();
    const settings = {};

    frontmatter.split('\n').forEach(line => {
      const colonIndex = line.indexOf(':');
      if (colonIndex !== -1) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        settings[key] = value;
      }
    });

    return settings;
  }

  applyFrontmatterSettings(content) {
    const settings = this.parseFrontmatter(content);

    // Apply theme
    if (settings.theme) {
      const theme = settings.theme.toLowerCase();
      const validThemes = ['default', 'dark', 'catppuccin', 'nord', 'solarized', 'light'];
      if (validThemes.includes(theme)) {
        document.body.className = `theme-${theme}`;
        if (this.isPreviewVisible) {
          document.body.classList.add('split-view');
        }
      }
    }

    // Apply font-size (support both kebab-case and camelCase)
    const fontSize = settings['font-size'] || settings.fontSize;
    if (fontSize) {
      const size = parseInt(fontSize, 10);
      if (!isNaN(size) && size >= 6 && size <= 72) {
        document.documentElement.style.setProperty('--editor-font-size', `${size}px`);
        this.preview.style.fontSize = `${size}px`;
      }
    }
  }

  getEditorMode() {
    if (!this.currentFilePath) return 'yaml-frontmatter';
    const ext = this.currentFilePath.split('.').pop().toLowerCase();
    const modeMap = {
      'md': 'yaml-frontmatter', 'markdown': 'yaml-frontmatter',
      'js': 'javascript', 'ts': 'javascript', 'json': 'javascript',
      'py': 'python',
      'yml': 'yaml', 'yaml': 'yaml',
      'sh': 'shell', 'bash': 'shell', 'zsh': 'shell',
      'go': 'go',
      'sql': 'sql',
      'lua': 'lua',
      'cs': 'clike', 'java': 'clike', 'c': 'clike', 'cpp': 'clike', 'h': 'clike',
      'xml': 'xml', 'html': 'xml', 'htm': 'xml',
      'css': 'css',
      'dockerfile': 'dockerfile',
      'tf': 'javascript', 'hcl': 'javascript' // HCL is similar enough to JS for basic highlighting
    };
    return modeMap[ext] || 'text/plain';
  }

  updateEditorMode() {
    const mode = this.getEditorMode();
    this.cm.setOption('mode', mode);
  }

  getFileLanguage() {
    if (!this.currentFilePath) return 'text';
    const ext = this.currentFilePath.split('.').pop().toLowerCase();
    const langMap = {
      'js': 'javascript', 'ts': 'typescript', 'py': 'python',
      'rb': 'ruby', 'go': 'go', 'rs': 'rust', 'java': 'java',
      'tf': 'hcl', 'hcl': 'hcl', 'yml': 'yaml', 'yaml': 'yaml',
      'json': 'json', 'sh': 'bash', 'bash': 'bash', 'zsh': 'bash',
      'sql': 'sql', 'cs': 'csharp', 'lua': 'lua', 'dockerfile': 'dockerfile',
      'html': 'html', 'css': 'css', 'xml': 'xml', 'toml': 'toml'
    };
    return langMap[ext] || ext;
  }

  updatePreview() {
    if (!this.isPreviewVisible) return;

    const content = this.getValue();

    // For non-markdown files, render as syntax-highlighted code
    if (!this.isMarkdownFile()) {
      const lang = this.getFileLanguage();
      const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      this.preview.innerHTML = `<pre><code class="language-${lang}">${escaped}</code></pre>`;
      if (window.hljs) {
        this.preview.querySelectorAll('pre code').forEach(block => {
          window.hljs.highlightElement(block);
        });
      }
      return;
    }

    const html = this.renderMarkdownWithSlides(content);
    this.preview.innerHTML = html;

    // Highlight code blocks
    this.preview.querySelectorAll('pre code').forEach((block) => {
      if (window.hljs) {
        window.hljs.highlightElement(block);
      }
    });

    // Render LaTeX math
    if (window.renderMathInElement) {
      window.renderMathInElement(this.preview, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false
      });
    }

    // Render PlantUML diagrams
    if (window.plantumlEncoder) {
      this.preview.querySelectorAll('pre code.language-plantuml').forEach((block) => {
        const code = block.textContent;
        const encoded = window.plantumlEncoder.encode(code);
        const img = document.createElement('img');
        img.src = `https://www.plantuml.com/plantuml/svg/${encoded}`;
        img.alt = 'PlantUML diagram';
        img.className = 'plantuml-diagram';
        block.parentElement.replaceWith(img);
      });
    }
  }

  renderMarkdownWithSlides(content) {
    // Remove frontmatter for preview
    let markdown = content;
    if (markdown.startsWith('---')) {
      const endIndex = markdown.indexOf('---', 3);
      if (endIndex !== -1) {
        markdown = markdown.substring(endIndex + 3).trim();
      }
    }

    // Split by slide separators and render each slide
    const slides = markdown.split(/\n---\n/);

    return slides.map((slide, index) => {
      // Split content and notes
      const parts = slide.split(/\n\?\?\?\n/);
      const slideContent = parts[0].trim();
      const notes = parts[1] ? parts[1].trim() : '';

      let html = '';

      if (index > 0) {
        html += `<div class="slide-separator">Slide ${index + 1}</div>`;
      }

      html += this.renderMarkdown(slideContent);

      if (notes) {
        html += `<div class="speaker-notes">${this.renderMarkdown(notes)}</div>`;
      }

      return html;
    }).join('');
  }

  renderMarkdown(text) {
    const basePath = this.basePath;

    // Replace emoji shortcodes
    if (window.replaceEmojis) {
      text = window.replaceEmojis(text);
    }

    // Pre-process: convert image size syntax ![alt](path =WxH) to HTML
    let processed = text.replace(
      /!\[([^\]]*)\]\(([^)\s]+)\s*=(\d*)x(\d*)\)/g,
      (match, alt, src, width, height) => {
        let style = '';
        if (width) style += `width:${width}px;`;
        if (height) style += `height:${height}px;`;
        // Resolve relative paths to file:// URLs
        let resolvedSrc = src;
        if (basePath && !src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('data:')) {
          resolvedSrc = `file://${basePath}/${src}`;
        }
        return `<img src="${resolvedSrc}" alt="${alt}" style="${style}">`;
      }
    );

    // Also handle regular markdown images without size syntax
    processed = processed.replace(
      /!\[([^\]]*)\]\(([^)\s]+)\)/g,
      (match, alt, src) => {
        if (src.includes('=')) return match; // Already processed with size
        let resolvedSrc = src;
        if (basePath && !src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('data:')) {
          resolvedSrc = `file://${basePath}/${src}`;
        }
        return `![${alt}](${resolvedSrc})`;
      }
    );

    if (window.marked) {
      return window.marked.parse(processed);
    }
    return this.simpleMarkdown(processed);
  }

  simpleMarkdown(text) {
    return text
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/^\- (.*$)/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>');
  }

  updateStatus() {
    const content = this.getValue();

    // File name
    if (this.currentFilePath) {
      const fileName = this.currentFilePath.split('/').pop();
      this.statusFile.textContent = this.isDirty ? `${fileName} (modified)` : fileName;
    } else {
      this.statusFile.textContent = this.isDirty ? 'Untitled (modified)' : 'Untitled';
    }

    // Count slides
    let markdown = content;
    if (markdown.startsWith('---')) {
      const endIndex = markdown.indexOf('---', 3);
      if (endIndex !== -1) {
        markdown = markdown.substring(endIndex + 3);
      }
    }
    const slides = markdown.split(/\n---\n/).filter(s => s.trim());
    this.statusSlides.textContent = `${slides.length} slide${slides.length !== 1 ? 's' : ''}`;

    // Count words
    const words = content.split(/\s+/).filter(w => w.length > 0).length;
    this.statusWords.textContent = `${words} words`;
  }

  updateOutline() {
    if (!this.isOutlineVisible) return;

    const content = this.getValue();
    const lines = content.split('\n');
    const items = [];
    let slideNum = 1;
    let inFrontmatter = false;
    let frontmatterEnd = false;

    lines.forEach((line, index) => {
      // Handle frontmatter
      if (index === 0 && line.trim() === '---') {
        inFrontmatter = true;
        return;
      }
      if (inFrontmatter && line.trim() === '---') {
        inFrontmatter = false;
        frontmatterEnd = true;
        return;
      }
      if (inFrontmatter) return;

      // Slide separator
      if (line.trim() === '---') {
        slideNum++;
        items.push({
          type: 'slide',
          text: `Slide ${slideNum}`,
          line: index
        });
        return;
      }

      // Headers
      const h1Match = line.match(/^# (.+)$/);
      const h2Match = line.match(/^## (.+)$/);
      const h3Match = line.match(/^### (.+)$/);

      if (h1Match) {
        items.push({ type: 'h1', text: h1Match[1], line: index });
      } else if (h2Match) {
        items.push({ type: 'h2', text: h2Match[1], line: index });
      } else if (h3Match) {
        items.push({ type: 'h3', text: h3Match[1], line: index });
      }
    });

    // Render outline
    this.outlineList.innerHTML = items.map(item => {
      if (item.type === 'slide') {
        return `<div class="outline-item slide-marker" data-line="${item.line}">${item.text}</div>`;
      }
      return `<div class="outline-item ${item.type}" data-line="${item.line}">${item.text}</div>`;
    }).join('');

    // Add click handlers
    this.outlineList.querySelectorAll('.outline-item').forEach(el => {
      el.addEventListener('click', () => {
        const lineNum = parseInt(el.dataset.line, 10);
        this.goToLine(lineNum);
      });
    });
  }

  goToLine(lineNum) {
    this.cm.setCursor({ line: lineNum, ch: 0 });
    this.cm.scrollIntoView({ line: lineNum, ch: 0 }, 200);
    this.cm.focus();
  }

  showFileContextMenu(el, x, y) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.file-context-menu');
    if (existingMenu) existingMenu.remove();

    const filePath = el.dataset.path;
    const isParentDir = el.classList.contains('parent-dir');

    // Don't show menu for parent directory (..)
    if (isParentDir) return;

    const menu = document.createElement('div');
    menu.className = 'file-context-menu';
    menu.innerHTML = `
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
      if (action === 'rename') {
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
      this.loadFileTree();
    } else if (result.error) {
      alert(result.error);
    }
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.editor = new Editor();
});

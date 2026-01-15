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

    this.currentFilePath = null;
    this.basePath = null;
    this.currentDirectory = null;
    this.isPreviewVisible = true;
    this.isFileTreeVisible = false;
    this.isOutlineVisible = false;
    this.isSearchVisible = false;
    this.isDirty = false;
    this.searchTimeout = null;
    this.pendingLineJump = null;

    this.setupEditor();
    this.setupToolbar();
    this.setupSearch();
    this.setupIPC();
    this.togglePreview(); // Start with preview visible
  }

  setupEditor() {
    // Initialize CodeMirror
    this.cm = CodeMirror(this.editorContainer, {
      mode: 'markdown',
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
        'Ctrl-K': () => this.insertLink()
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

  setupToolbar() {
    document.getElementById('btn-bold').addEventListener('click', () => this.wrapSelection('**', '**'));
    document.getElementById('btn-italic').addEventListener('click', () => this.wrapSelection('*', '*'));
    document.getElementById('btn-code').addEventListener('click', () => this.wrapSelection('`', '`'));
    document.getElementById('btn-link').addEventListener('click', () => this.insertLink());

    document.getElementById('btn-h1').addEventListener('click', () => this.insertAtLineStart('# '));
    document.getElementById('btn-h2').addEventListener('click', () => this.insertAtLineStart('## '));
    document.getElementById('btn-h3').addEventListener('click', () => this.insertAtLineStart('### '));

    document.getElementById('btn-bullet').addEventListener('click', () => this.insertAtLineStart('- '));
    document.getElementById('btn-quote').addEventListener('click', () => this.insertAtLineStart('> '));
    document.getElementById('btn-hr').addEventListener('click', () => this.insertText('\n---\n'));

    document.getElementById('btn-slide').addEventListener('click', () => this.insertSlide());

    document.getElementById('btn-outline').addEventListener('click', () => this.toggleOutline());
    document.getElementById('btn-preview').addEventListener('click', () => this.togglePreview());
    document.getElementById('btn-present').addEventListener('click', () => {
      // Sync content and start presentation with presenter view
      window.vomit.contentChanged(this.getValue());
      window.vomit.startPresentationWithPresenter();
    });
  }

  setupIPC() {
    window.addEventListener('vomit:load-content', (e) => {
      const { content, filePath, basePath } = e.detail;
      this.setValue(content);
      this.currentFilePath = filePath;
      this.basePath = basePath;
      this.currentDirectory = basePath;
      this.isDirty = false;
      this.updatePreview();
      this.updateStatus();
      if (this.isOutlineVisible) {
        this.updateOutline();
      }
      if (this.isFileTreeVisible) {
        this.loadFileTree();
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

    window.addEventListener('vomit:toggle-search', () => {
      this.toggleSearch();
    });

    window.addEventListener('vomit:format-command', (e) => {
      const command = e.detail;
      switch (command) {
        case 'bold': this.wrapSelection('**', '**'); break;
        case 'italic': this.wrapSelection('*', '*'); break;
        case 'code': this.wrapSelection('`', '`'); break;
        case 'link': this.insertLink(); break;
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
    if (this.isFileTreeVisible) {
      // Close other sidebars
      this.isOutlineVisible = false;
      this.isSearchVisible = false;
      this.sidebarOutline.classList.add('hidden');
      this.sidebarSearch.classList.add('hidden');
      this.loadFileTree();
    }
  }

  toggleOutline() {
    this.isOutlineVisible = !this.isOutlineVisible;
    this.sidebarOutline.classList.toggle('hidden', !this.isOutlineVisible);
    if (this.isOutlineVisible) {
      // Close other sidebars
      this.isFileTreeVisible = false;
      this.isSearchVisible = false;
      this.sidebarFiles.classList.add('hidden');
      this.sidebarSearch.classList.add('hidden');
      this.updateOutline();
    }
  }

  setupSearch() {
    // Debounced search on input
    this.searchInput.addEventListener('input', () => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => this.performSearch(), 300);
    });

    // Search on Enter
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(this.searchTimeout);
        this.performSearch();
      }
    });
  }

  toggleSearch() {
    this.isSearchVisible = !this.isSearchVisible;
    this.sidebarSearch.classList.toggle('hidden', !this.isSearchVisible);
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
      this.fileTree.innerHTML = '<div class="file-item" style="color: var(--text-muted);">No files</div>';
      return;
    }

    this.fileTree.innerHTML = items.map(item => {
      const isActive = item.path === this.currentFilePath;
      const typeClass = item.isDirectory ? 'directory' : (item.isMarkdown ? 'markdown' : 'file');
      const activeClass = isActive ? 'active' : '';

      return `<div class="file-item ${typeClass} ${activeClass}" data-path="${item.path}" data-is-dir="${item.isDirectory}">
        <span class="icon"></span>
        <span class="name">${item.name}</span>
      </div>`;
    }).join('');

    // Add click handlers
    this.fileTree.querySelectorAll('.file-item').forEach(el => {
      el.addEventListener('click', () => {
        const filePath = el.dataset.path;
        const isDir = el.dataset.isDir === 'true';

        if (isDir) {
          // Navigate into directory
          this.currentDirectory = filePath;
          this.loadFileTree();
        } else if (filePath.endsWith('.md') || filePath.endsWith('.markdown')) {
          // Open markdown file
          window.vomit.openFile(filePath);
        }
      });
    });

    // Add parent directory item if not at root
    const parentItem = document.createElement('div');
    parentItem.className = 'file-item directory';
    parentItem.innerHTML = '<span class="icon" style="transform: rotate(180deg);">&#x2191;</span><span class="name">..</span>';
    parentItem.addEventListener('click', () => {
      const parts = this.currentDirectory.split('/');
      if (parts.length > 2) {
        parts.pop();
        this.currentDirectory = parts.join('/');
        this.loadFileTree();
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

  togglePreview() {
    this.isPreviewVisible = !this.isPreviewVisible;
    this.previewPane.classList.toggle('visible', this.isPreviewVisible);
    document.body.classList.toggle('split-view', this.isPreviewVisible);

    if (this.isPreviewVisible) {
      this.updatePreview();
    }
  }

  updatePreview() {
    if (!this.isPreviewVisible) return;

    const content = this.getValue();
    const html = this.renderMarkdownWithSlides(content);
    this.preview.innerHTML = html;

    // Highlight code blocks
    this.preview.querySelectorAll('pre code').forEach((block) => {
      if (window.hljs) {
        window.hljs.highlightElement(block);
      }
    });
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
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.editor = new Editor();
});

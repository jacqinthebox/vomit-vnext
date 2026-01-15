// Editor - Simple markdown editor with preview
class Editor {
  constructor() {
    this.editor = document.getElementById('editor');
    this.preview = document.getElementById('preview');
    this.previewPane = document.getElementById('preview-pane');
    this.statusFile = document.getElementById('status-file');
    this.statusSlides = document.getElementById('status-slides');
    this.statusWords = document.getElementById('status-words');
    this.sidebar = document.getElementById('sidebar');
    this.outlineList = document.getElementById('outline-list');

    this.currentFilePath = null;
    this.basePath = null;
    this.isPreviewVisible = true;
    this.isSidebarVisible = false;
    this.isDirty = false;

    this.setupEditor();
    this.setupToolbar();
    this.setupIPC();
    this.togglePreview(); // Start with preview visible
  }

  setupEditor() {
    this.editor.addEventListener('input', () => {
      this.updatePreview();
      this.updateStatus();
      this.updateOutline();
      this.isDirty = true;
      window.vomit.contentChanged(this.editor.value);
    });

    // Tab key handling
    this.editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = this.editor.selectionStart;
        const end = this.editor.selectionEnd;
        this.editor.value = this.editor.value.substring(0, start) + '  ' + this.editor.value.substring(end);
        this.editor.selectionStart = this.editor.selectionEnd = start + 2;
        this.updatePreview();
      }
    });

    // Paste image handling
    this.editor.addEventListener('paste', async (e) => {
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

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case 'b':
            e.preventDefault();
            this.wrapSelection('**', '**');
            break;
          case 'i':
            e.preventDefault();
            this.wrapSelection('*', '*');
            break;
          case '`':
            e.preventDefault();
            this.wrapSelection('`', '`');
            break;
          case 'k':
            e.preventDefault();
            this.insertLink();
            break;
        }
      }
    });
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

    document.getElementById('btn-outline').addEventListener('click', () => this.toggleSidebar());
    document.getElementById('btn-preview').addEventListener('click', () => this.togglePreview());
    document.getElementById('btn-present').addEventListener('click', () => {
      // Sync content and start presentation with presenter view
      window.vomit.contentChanged(this.editor.value);
      window.vomit.startPresentationWithPresenter();
    });
  }

  setupIPC() {
    window.addEventListener('vomit:load-content', (e) => {
      const { content, filePath, basePath } = e.detail;
      this.editor.value = content;
      this.currentFilePath = filePath;
      this.basePath = basePath;
      this.isDirty = false;
      this.updatePreview();
      this.updateStatus();
      this.updateOutline();
    });

    window.addEventListener('vomit:request-content', () => {
      window.vomit.saveContent(this.editor.value);
      this.isDirty = false;
    });

    window.addEventListener('vomit:toggle-preview', () => {
      this.togglePreview();
    });

    window.addEventListener('vomit:toggle-outline', () => {
      this.toggleSidebar();
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

  wrapSelection(before, after) {
    const start = this.editor.selectionStart;
    const end = this.editor.selectionEnd;
    const text = this.editor.value;
    const selected = text.substring(start, end);

    this.editor.value = text.substring(0, start) + before + selected + after + text.substring(end);
    this.editor.selectionStart = start + before.length;
    this.editor.selectionEnd = start + before.length + selected.length;
    this.editor.focus();
    this.updatePreview();
  }

  insertAtLineStart(prefix) {
    const start = this.editor.selectionStart;
    const text = this.editor.value;

    // Find the start of the current line
    let lineStart = start;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') {
      lineStart--;
    }

    this.editor.value = text.substring(0, lineStart) + prefix + text.substring(lineStart);
    this.editor.selectionStart = this.editor.selectionEnd = start + prefix.length;
    this.editor.focus();
    this.updatePreview();
  }

  insertText(text) {
    const start = this.editor.selectionStart;
    const value = this.editor.value;

    this.editor.value = value.substring(0, start) + text + value.substring(start);
    this.editor.selectionStart = this.editor.selectionEnd = start + text.length;
    this.editor.focus();
    this.updatePreview();
  }

  insertLink() {
    const start = this.editor.selectionStart;
    const end = this.editor.selectionEnd;
    const text = this.editor.value;
    const selected = text.substring(start, end);

    const linkText = selected || 'link text';
    const link = `[${linkText}](url)`;

    this.editor.value = text.substring(0, start) + link + text.substring(end);

    // Position cursor at 'url'
    const urlStart = start + linkText.length + 3;
    this.editor.selectionStart = urlStart;
    this.editor.selectionEnd = urlStart + 3;
    this.editor.focus();
    this.updatePreview();
  }

  insertSlide() {
    const start = this.editor.selectionStart;
    const text = this.editor.value;

    // Add slide separator and template
    const slideTemplate = '\n\n---\n\n# New Slide\n\nContent here\n\n???\nSpeaker notes here\n';

    this.editor.value = text.substring(0, start) + slideTemplate + text.substring(start);
    this.editor.selectionStart = this.editor.selectionEnd = start + 9; // Position after "# "
    this.editor.focus();
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

    const content = this.editor.value;
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
    const content = this.editor.value;

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

  toggleSidebar() {
    this.isSidebarVisible = !this.isSidebarVisible;
    this.sidebar.classList.toggle('hidden', !this.isSidebarVisible);
    if (this.isSidebarVisible) {
      this.updateOutline();
    }
  }

  updateOutline() {
    if (!this.isSidebarVisible) return;

    const content = this.editor.value;
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
    const content = this.editor.value;
    const lines = content.split('\n');
    let position = 0;

    for (let i = 0; i < lineNum && i < lines.length; i++) {
      position += lines[i].length + 1; // +1 for newline
    }

    this.editor.focus();
    this.editor.setSelectionRange(position, position);

    // Scroll the line into view
    const lineHeight = 22; // approximate line height
    const scrollTop = lineNum * lineHeight - this.editor.clientHeight / 2;
    this.editor.scrollTop = Math.max(0, scrollTop);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.editor = new Editor();
});

// PreviewManager — Preview rendering, status bar, outline, frontmatter, and editor mode.

class PreviewManager {
  constructor({ state, host, dom }) {
    this.state = state;
    this.host = host;
    this.dom = dom;  // { preview, previewPane, editorContainer, statusFile, statusSlides, statusWords, outlineList }
  }

  togglePreview() {
    const body = document.body;

    if (!this.state.isPreviewVisible) {
      this.state.isPreviewVisible = true;
      this.state.viewMode = 'split';
      body.classList.remove('editor-only', 'preview-only');
      body.classList.add('split-view');
      this.dom.previewPane.classList.add('visible');
      this.updatePreview();
    } else if (this.state.viewMode === 'split') {
      this.state.viewMode = 'preview';
      body.classList.remove('split-view', 'editor-only');
      body.classList.add('preview-only');
    } else {
      this.state.isPreviewVisible = false;
      this.state.viewMode = 'editor';
      body.classList.remove('split-view', 'preview-only');
      body.classList.add('editor-only');
      this.dom.previewPane.classList.remove('visible');
      this.host.cm.focus();
    }
  }

  isMarkdownFile() {
    if (!this.state.currentFilePath) return true;
    const ext = this.state.currentFilePath.split('.').pop().toLowerCase();
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

    if (settings.theme) {
      const theme = settings.theme.toLowerCase();
      const validThemes = ['default', 'dark', 'catppuccin', 'nord', 'solarized', 'light'];
      if (validThemes.includes(theme)) {
        document.body.className = `theme-${theme}`;
        if (this.state.isPreviewVisible) {
          document.body.classList.add('split-view');
        }
      }
    }

    const fontSize = settings['font-size'] || settings.fontSize;
    if (fontSize) {
      const size = parseInt(fontSize, 10);
      if (!isNaN(size) && size >= 6 && size <= 72) {
        document.documentElement.style.setProperty('--editor-font-size', `${size}px`);
        this.dom.preview.style.fontSize = `${size}px`;
      }
    }
  }

  getEditorMode() {
    if (!this.state.currentFilePath) return 'yaml-frontmatter';
    const ext = this.state.currentFilePath.split('.').pop().toLowerCase();
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
      'tf': 'javascript', 'hcl': 'javascript'
    };
    return modeMap[ext] || 'text/plain';
  }

  updateEditorMode() {
    const mode = this.getEditorMode();
    this.host.cm.setOption('mode', mode);
  }

  getFileLanguage() {
    if (!this.state.currentFilePath) return 'text';
    const ext = this.state.currentFilePath.split('.').pop().toLowerCase();
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
    if (!this.state.isPreviewVisible) return;

    const content = this.host.cm.getValue();

    if (!this.isMarkdownFile()) {
      const lang = this.getFileLanguage();
      const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      this.dom.preview.innerHTML = `<pre><code class="language-${lang}">${escaped}</code></pre>`;
      if (window.hljs) {
        this.dom.preview.querySelectorAll('pre code').forEach(block => {
          window.hljs.highlightElement(block);
        });
      }
      return;
    }

    const html = this.renderMarkdownWithSlides(content);
    this.dom.preview.innerHTML = html;

    // Highlight code blocks
    this.dom.preview.querySelectorAll('pre code').forEach((block) => {
      if (window.hljs) {
        window.hljs.highlightElement(block);
      }
    });

    // Render LaTeX math
    if (window.renderMathInElement) {
      window.renderMathInElement(this.dom.preview, {
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
      this.dom.preview.querySelectorAll('pre code.language-plantuml').forEach((block) => {
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
    let markdown = content;
    if (markdown.startsWith('---')) {
      const endIndex = markdown.indexOf('---', 3);
      if (endIndex !== -1) {
        markdown = markdown.substring(endIndex + 3).trim();
      }
    }

    const slides = markdown.split(/\n---\n/);

    return slides.map((slide, index) => {
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
    const basePath = this.state.basePath;

    if (window.replaceEmojis) {
      text = window.replaceEmojis(text);
    }

    let processed = text.replace(
      /!\[([^\]]*)\]\(([^)\s]+)\s*=(\d*)x(\d*)\)/g,
      (match, alt, src, width, height) => {
        let style = '';
        if (width) style += `width:${width}px;`;
        if (height) style += `height:${height}px;`;
        let resolvedSrc = src;
        if (basePath && !src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('data:')) {
          resolvedSrc = `file://${basePath}/${src}`;
        }
        return `<img src="${resolvedSrc}" alt="${alt}" style="${style}">`;
      }
    );

    processed = processed.replace(
      /!\[([^\]]*)\]\(([^)\s]+)\)/g,
      (match, alt, src) => {
        if (src.includes('=')) return match;
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
    const content = this.host.cm.getValue();

    if (this.state.currentFilePath) {
      const modified = this.state.isDirty ? ' (modified)' : '';
      const displayPath = this.state.currentFilePath.replace(/^\/Users\/[^/]+/, '~');
      this.dom.statusFile.textContent = displayPath + modified;
      this.dom.statusFile.title = this.state.currentFilePath;
    } else {
      this.dom.statusFile.textContent = this.state.isDirty ? 'Untitled (modified)' : 'Untitled';
      this.dom.statusFile.title = '';
    }

    let markdown = content;
    if (markdown.startsWith('---')) {
      const endIndex = markdown.indexOf('---', 3);
      if (endIndex !== -1) {
        markdown = markdown.substring(endIndex + 3);
      }
    }
    const slides = markdown.split(/\n---\n/).filter(s => s.trim());
    this.dom.statusSlides.textContent = `${slides.length} slide${slides.length !== 1 ? 's' : ''}`;

    const words = content.split(/\s+/).filter(w => w.length > 0).length;
    this.dom.statusWords.textContent = `${words} words`;
  }

  updateOutline() {
    if (!this.state.isOutlineVisible) return;

    const content = this.host.cm.getValue();
    const lines = content.split('\n');
    const items = [];
    let slideNum = 1;
    let inFrontmatter = false;

    lines.forEach((line, index) => {
      if (index === 0 && line.trim() === '---') {
        inFrontmatter = true;
        return;
      }
      if (inFrontmatter && line.trim() === '---') {
        inFrontmatter = false;
        return;
      }
      if (inFrontmatter) return;

      if (line.trim() === '---') {
        slideNum++;
        items.push({
          type: 'slide',
          text: `Slide ${slideNum}`,
          line: index
        });
        return;
      }

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

    this.dom.outlineList.innerHTML = items.map(item => {
      if (item.type === 'slide') {
        return `<div class="outline-item slide-marker" data-line="${item.line}">${item.text}</div>`;
      }
      return `<div class="outline-item ${item.type}" data-line="${item.line}">${item.text}</div>`;
    }).join('');

    this.dom.outlineList.querySelectorAll('.outline-item').forEach(el => {
      el.addEventListener('click', () => {
        const lineNum = parseInt(el.dataset.line, 10);
        this.goToLine(lineNum);
      });
    });
  }

  goToLine(lineNum) {
    this.host.cm.setCursor({ line: lineNum, ch: 0 });
    this.host.cm.scrollIntoView({ line: lineNum, ch: 0 }, 200);
    this.host.cm.focus();
  }
}

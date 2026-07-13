// PreviewManager — Preview rendering, status bar, outline, frontmatter, and editor mode.

// Initialize Mermaid with configurable curve style
let mermaidCurve = 'linear';

function initMermaid(curve) {
  if (window.mermaid) {
    mermaidCurve = curve || 'linear';
    window.mermaid.initialize({
      startOnLoad: false,
      flowchart: { curve: mermaidCurve },
      theme: 'dark'
    });
  }
}

// Load initial setting
if (window.vomit && window.vomit.getMermaidCurve) {
  window.vomit.getMermaidCurve().then(curve => initMermaid(curve));
} else {
  initMermaid('linear');
}

// Listen for curve changes
window.addEventListener('vomit:mermaid-curve-changed', (e) => {
  initMermaid(e.detail);
  // Trigger re-render if editor exists
  if (window.editor && window.editor.previewManager) {
    window.editor.previewManager.updatePreview();
  }
});

class PreviewManager {
  constructor({ state, host, dom }) {
    this.state = state;
    this.host = host;
    this.dom = dom;  // { preview, previewPane, editorContainer, statusFile, statusSlides, statusWords, outlineList, rightOutline, rightOutlineList, rightSidebarResize }

    // Scroll sync state
    this._isSyncingScroll = false;
    this._scrollSyncEnabled = true;

    // Setup scroll synchronization
    this.setupScrollSync();

    // Clicking a rendered [[wikilink]] opens the target document; clicking an
    // external link opens it in the browser.
    this.setupLinkClicks();
  }

  setupLinkClicks() {
    this.dom.preview.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (!link) return;

      // Internal [[wikilink]] → open the target document in the editor.
      if (link.classList.contains('wikilink')) {
        e.preventDefault();
        const target = link.dataset.wikilink;
        if (target) {
          window.dispatchEvent(new CustomEvent('vomit:open-wikilink', { detail: target }));
        }
        return;
      }

      // External http(s) link → open in the default browser. Without this the
      // click navigates the renderer away from the app and crashes it.
      if (link.href && (link.href.startsWith('http://') || link.href.startsWith('https://'))) {
        e.preventDefault();
        window.vomit.openExternal(link.href);
      }
    });
  }

  setupScrollSync() {
    // Listen to CodeMirror scroll events
    this.host.cm.on('scroll', () => {
      if (!this._scrollSyncEnabled || this._isSyncingScroll) return;
      if (!this.state.isPreviewVisible || this.state.viewMode !== 'split') return;

      this._isSyncingScroll = true;

      const scrollInfo = this.host.cm.getScrollInfo();
      const maxEditorScroll = scrollInfo.height - scrollInfo.clientHeight;

      if (maxEditorScroll > 0) {
        const scrollPercent = scrollInfo.top / maxEditorScroll;
        // Use previewPane (the scrollable container), not preview (the content)
        const maxPreviewScroll = this.dom.previewPane.scrollHeight - this.dom.previewPane.clientHeight;
        this.dom.previewPane.scrollTop = scrollPercent * maxPreviewScroll;
      }

      // Reset flag after a small delay to allow the scroll to complete
      setTimeout(() => {
        this._isSyncingScroll = false;
      }, 50);
    });

    // Listen to preview pane scroll events (previewPane is the scrollable container)
    this.dom.previewPane.addEventListener('scroll', () => {
      if (!this._scrollSyncEnabled || this._isSyncingScroll) return;
      if (!this.state.isPreviewVisible || this.state.viewMode !== 'split') return;

      this._isSyncingScroll = true;

      const maxPreviewScroll = this.dom.previewPane.scrollHeight - this.dom.previewPane.clientHeight;

      if (maxPreviewScroll > 0) {
        const scrollPercent = this.dom.previewPane.scrollTop / maxPreviewScroll;
        const scrollInfo = this.host.cm.getScrollInfo();
        const maxEditorScroll = scrollInfo.height - scrollInfo.clientHeight;
        this.host.cm.scrollTo(null, scrollPercent * maxEditorScroll);
      }

      // Reset flag after a small delay to allow the scroll to complete
      setTimeout(() => {
        this._isSyncingScroll = false;
      }, 50);
    });
  }

  toggleScrollSync() {
    this._scrollSyncEnabled = !this._scrollSyncEnabled;
    return this._scrollSyncEnabled;
  }

  syncEditorToPreview() {
    if (!this.state.isPreviewVisible || this.state.viewMode !== 'split') return;

    // Use requestAnimationFrame to ensure preview has rendered
    requestAnimationFrame(() => {
      const scrollInfo = this.host.cm.getScrollInfo();
      const maxEditorScroll = scrollInfo.height - scrollInfo.clientHeight;

      if (maxEditorScroll > 0) {
        const scrollPercent = scrollInfo.top / maxEditorScroll;
        const maxPreviewScroll = this.dom.previewPane.scrollHeight - this.dom.previewPane.clientHeight;
        this.dom.previewPane.scrollTop = scrollPercent * maxPreviewScroll;
      }
    });
  }

  toggleEditorPreviewFocus() {
    if (!this.state.isPreviewVisible || this.state.viewMode !== 'split') return;

    // Make preview pane focusable if not already
    if (!this.dom.previewPane.hasAttribute('tabindex')) {
      this.dom.previewPane.setAttribute('tabindex', '-1');
    }

    // Check if editor currently has focus
    const editorHasFocus = this.host.cm.hasFocus();

    if (editorHasFocus) {
      // Focus preview
      this.dom.previewPane.focus();
    } else {
      // Focus editor
      this.host.cm.focus();
    }
  }

  toggleRightOutline() {
    this.state.isRightOutlineVisible = !this.state.isRightOutlineVisible;
    this.dom.rightOutline.classList.toggle('hidden', !this.state.isRightOutlineVisible);
    this.dom.rightSidebarResize.classList.toggle('hidden', !this.state.isRightOutlineVisible);

    if (this.state.isRightOutlineVisible) {
      this.updateRightOutline();
    }
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
      // Sync scroll position after preview is rendered
      this.syncEditorToPreview();
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

  isViewerFile() {
    if (!this.state.currentFilePath) return false;
    const ext = this.state.currentFilePath.split('.').pop().toLowerCase();
    return ['pdf', 'drawio', ...this.getImageExtensions()].includes(ext);
  }

  getImageExtensions() {
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];
  }

  parseFrontmatter(content) {
    return window.Frontmatter.parseSettings(content);
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
      'tf': 'terraform', 'hcl': 'terraform', 'tfvars': 'terraform',
      'ps1': 'powershell', 'psm1': 'powershell', 'psd1': 'powershell'
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
      'tf': 'terraform', 'hcl': 'terraform', 'tfvars': 'terraform',
      'ps1': 'powershell', 'psm1': 'powershell', 'psd1': 'powershell',
      'yml': 'yaml', 'yaml': 'yaml',
      'json': 'json', 'sh': 'bash', 'bash': 'bash', 'zsh': 'bash',
      'sql': 'sql', 'cs': 'csharp', 'lua': 'lua', 'dockerfile': 'dockerfile',
      'html': 'html', 'css': 'css', 'xml': 'xml', 'toml': 'toml'
    };
    return langMap[ext] || ext;
  }

  updatePreview() {
    if (!this.state.isPreviewVisible) return;
    // Don't overwrite viewer content (PDF, draw.io)
    if (this.state._isViewerMode) return;

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

    // Render Mermaid diagrams
    if (window.mermaid) {
      const mermaidBlocks = this.dom.preview.querySelectorAll('pre code.language-mermaid');
      if (mermaidBlocks.length > 0) {
        mermaidBlocks.forEach((block, index) => {
          const code = block.textContent;
          const div = document.createElement('div');
          div.className = 'mermaid';
          div.id = `mermaid-preview-${Date.now()}-${index}`;
          div.textContent = code;
          block.parentElement.replaceWith(div);
        });
        window.mermaid.run({ querySelector: '.mermaid' });
      }
    }

    // Add copy-to-clipboard buttons to remaining code blocks
    this.addCopyButtons();
  }

  /**
   * Add a "copy" button to every rendered code block. Runs after diagram
   * blocks (PlantUML/Mermaid) have been replaced, so those are skipped.
   */
  addCopyButtons() {
    this.dom.preview.querySelectorAll('pre').forEach((pre) => {
      const code = pre.querySelector('code');
      if (!code) return;
      if (pre.querySelector('.code-copy-btn')) return;

      pre.classList.add('has-copy-btn');

      const btn = document.createElement('button');
      btn.className = 'code-copy-btn';
      btn.type = 'button';
      btn.title = 'Copy code';
      btn.setAttribute('aria-label', 'Copy code');
      btn.innerHTML = this._copyIconSvg();

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(code.textContent);
          btn.classList.add('copied');
          btn.innerHTML = this._checkIconSvg();
          setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = this._copyIconSvg();
          }, 1500);
        } catch (err) {
          // Clipboard may be unavailable; leave the button state unchanged.
        }
      });

      pre.appendChild(btn);
    });
  }

  _copyIconSvg() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  }

  _checkIconSvg() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  }

  /**
   * Show a viewer-mode file (PDF, draw.io, or image) in the preview pane.
   * Switches to preview-only layout, hides the editor.
   */
  async showViewerFile(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();

    // Force preview-only mode with viewer-specific layout
    const body = document.body;
    body.classList.remove('editor-only', 'split-view');
    body.classList.add('preview-only', 'viewer-mode');
    this.dom.previewPane.classList.add('visible');
    this.state.isPreviewVisible = true;
    this.state.viewMode = 'preview';
    this.dom.preview.innerHTML = `<div class="viewer-loading">Loading ${this._escapeHtml(window.PathUtils.basename(filePath))}...</div>`;

    if (ext === 'pdf') {
      await this._renderPDF(filePath);
    } else if (ext === 'drawio') {
      await this._renderDrawio(filePath);
    } else if (this.getImageExtensions().includes(ext)) {
      await this._renderImage(filePath, ext);
    }
  }

  async _renderPDF(filePath) {
    try {
      const pdfUrl = window.PathUtils.toVomitFileUrl(filePath);
      const escapedPath = this._escapeHtml(filePath);
      this.dom.preview.innerHTML = `
        <div class="viewer-container pdf-viewer">
          <embed src="${pdfUrl}" type="application/pdf" />
          <button class="viewer-open-external" type="button" data-file-path="${escapedPath}">Open in external viewer</button>
        </div>`;
      const button = this.dom.preview.querySelector('.viewer-open-external');
      if (button) {
        button.addEventListener('click', () => window.vomit.openWithDefault(filePath));
      }
    } catch (err) {
      this.dom.preview.innerHTML = `<div class="viewer-error"><p>Failed to load PDF: ${err.message}</p></div>`;
    }
  }

  async _renderImage(filePath, ext) {
    try {
      const imageUrl = window.PathUtils.toVomitFileUrl(filePath);
      const escapedPath = this._escapeHtml(filePath);
      const escapedName = this._escapeHtml(window.PathUtils.basename(filePath));
      this.dom.preview.innerHTML = `
        <div class="viewer-container image-viewer">
          <div class="image-viewer-stage">
            <img src="${imageUrl}" alt="${escapedName}" />
          </div>
          <button class="viewer-open-external" type="button" data-file-path="${escapedPath}">Open in external viewer</button>
        </div>`;
      const button = this.dom.preview.querySelector('.viewer-open-external');
      if (button) {
        button.addEventListener('click', () => window.vomit.openWithDefault(filePath));
      }
    } catch (err) {
      this.dom.preview.innerHTML = `<div class="viewer-error"><p>Failed to load image: ${err.message}</p></div>`;
    }
  }

  async _renderDrawio(filePath) {
    try {
      const svg = await window.vomit.renderDrawioSvg(filePath);
      this.dom.preview.innerHTML = `
        <div class="viewer-container drawio-viewer drawio-svg-export">${svg}</div>`;
      return;
    } catch (exportErr) {
      // Fall through to the lightweight local XML renderer if draw.io CLI is unavailable.
    }

    try {
      const data = await window.vomit.readDrawioFile(filePath);
      const svgContent = this._extractDrawioSVG(data.xml);
      if (svgContent) {
        this.dom.preview.innerHTML = `
          <div class="viewer-container drawio-viewer">${svgContent}</div>`;
        // Scale SVG to fit
        const svg = this.dom.preview.querySelector('svg');
        if (svg) {
          svg.style.maxWidth = '100%';
          svg.style.height = 'auto';
        }
      } else {
        const rendered = this._renderDrawioDiagrams(data.diagrams);
        this.dom.preview.innerHTML = `
          <div class="viewer-container drawio-viewer">${rendered}</div>`;
      }
    } catch (err) {
      this.dom.preview.innerHTML = `<div class="viewer-error"><p>Failed to load draw.io file: ${err.message}</p></div>`;
    }
  }

  _renderDrawioDiagrams(diagrams) {
    if (!diagrams || diagrams.length === 0) {
      return '<p class="viewer-info">No diagrams found in this file.</p>';
    }

    return diagrams.map((diagram, index) => {
      const name = diagram.name || `Diagram ${index + 1}`;
      const svg = diagram.xml ? this._renderDrawioModelToSvg(diagram.xml) : null;
      return `<div class="drawio-diagram-card">
        <h3>${this._escapeHtml(name)}</h3>
        ${svg || '<p class="viewer-info">This diagram could not be decoded for native preview.</p>'}
      </div>`;
    }).join('');
  }

  _renderDrawioModelToSvg(xmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');
    const cells = Array.from(doc.querySelectorAll('mxCell'));
    const cellById = new Map(cells.map(cell => [cell.getAttribute('id'), cell]));
    const nodeById = new Map();
    const nodes = [];

    cells.forEach(cell => {
      if (cell.getAttribute('vertex') !== '1') return;
      const geometry = cell.querySelector('mxGeometry');
      if (!geometry) return;
      const position = this._absoluteDrawioPosition(cell, cellById);
      const width = Number(geometry.getAttribute('width') || 120);
      const height = Number(geometry.getAttribute('height') || 60);
      const node = {
        id: cell.getAttribute('id'),
        label: this._stripHtml(cell.getAttribute('value') || ''),
        style: cell.getAttribute('style') || '',
        x: position.x,
        y: position.y,
        width,
        height
      };
      nodes.push(node);
      nodeById.set(node.id, node);
    });

    if (nodes.length === 0) return null;

    const minX = Math.min(...nodes.map(node => node.x)) - 40;
    const minY = Math.min(...nodes.map(node => node.y)) - 40;
    const maxX = Math.max(...nodes.map(node => node.x + node.width)) + 40;
    const maxY = Math.max(...nodes.map(node => node.y + node.height)) + 40;
    const edges = cells.filter(cell => cell.getAttribute('edge') === '1');

    let svg = `<svg class="drawio-native-svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" xmlns="http://www.w3.org/2000/svg">`;
    svg += '<rect class="drawio-canvas" x="' + minX + '" y="' + minY + '" width="' + (maxX - minX) + '" height="' + (maxY - minY) + '" />';

    edges.forEach(edge => {
      const source = nodeById.get(edge.getAttribute('source'));
      const target = nodeById.get(edge.getAttribute('target'));
      if (!source || !target) return;
      const points = this._drawioEdgePoints(edge, source, target);
      const pointList = points.map(point => `${point.x},${point.y}`).join(' ');
      svg += `<polyline class="drawio-native-edge" points="${pointList}" />`;
      const label = this._stripHtml(edge.getAttribute('value') || '');
      if (label) {
        const midpoint = points[Math.floor(points.length / 2)];
        svg += `<text class="drawio-native-edge-label" x="${midpoint.x}" y="${midpoint.y - 6}" text-anchor="middle">${this._escapeHtml(label)}</text>`;
      }
    });

    nodes.forEach(node => {
      const fill = this._styleValue(node.style, 'fillColor') || '#ffffff';
      const stroke = this._styleValue(node.style, 'strokeColor') || '#6c7086';
      const isTextOnly = node.style.startsWith('text;') || node.style.includes('text;') || (fill === 'none' && stroke === 'none');
      const isEllipse = node.style.includes('ellipse');

      if (!isTextOnly) {
        if (isEllipse) {
          svg += `<ellipse cx="${node.x + node.width / 2}" cy="${node.y + node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}" fill="${this._drawioColor(fill)}" stroke="${this._drawioColor(stroke)}" />`;
        } else {
          const radius = node.style.includes('rounded=1') ? 8 : 2;
          svg += `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${radius}" fill="${this._drawioColor(fill)}" stroke="${this._drawioColor(stroke)}" />`;
        }
      }

      if (node.label) {
        svg += this._renderDrawioLabel(node);
      }
    });

    svg += '</svg>';
    return svg;
  }

  _absoluteDrawioPosition(cell, cellById) {
    const geometry = cell.querySelector('mxGeometry');
    let x = Number(geometry?.getAttribute('x') || 0);
    let y = Number(geometry?.getAttribute('y') || 0);
    let parent = cellById.get(cell.getAttribute('parent'));

    while (parent && parent.getAttribute('vertex') === '1') {
      const parentGeometry = parent.querySelector('mxGeometry');
      x += Number(parentGeometry?.getAttribute('x') || 0);
      y += Number(parentGeometry?.getAttribute('y') || 0);
      parent = cellById.get(parent.getAttribute('parent'));
    }

    return { x, y };
  }

  _drawioEdgePoints(edge, source, target) {
    const geometry = edge.querySelector('mxGeometry');
    const points = [
      { x: source.x + source.width / 2, y: source.y + source.height / 2 }
    ];

    geometry?.querySelectorAll('Array[as="points"] mxPoint').forEach(point => {
      points.push({
        x: Number(point.getAttribute('x') || 0),
        y: Number(point.getAttribute('y') || 0)
      });
    });

    points.push({ x: target.x + target.width / 2, y: target.y + target.height / 2 });
    return points;
  }

  _renderDrawioLabel(node) {
    const fontSize = Number(this._styleValue(node.style, 'fontSize') || 12);
    const fontColor = this._drawioColor(this._styleValue(node.style, 'fontColor') || '#111827');
    const align = this._styleValue(node.style, 'align') || 'center';
    const verticalAlign = this._styleValue(node.style, 'verticalAlign') || 'middle';
    const escapedLabel = this._escapeHtml(node.label).replace(/\n/g, '<br>');
    const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
    const items = verticalAlign === 'top' ? 'flex-start' : verticalAlign === 'bottom' ? 'flex-end' : 'center';

    return `<foreignObject x="${node.x + 4}" y="${node.y + 4}" width="${Math.max(1, node.width - 8)}" height="${Math.max(1, node.height - 8)}">
      <div xmlns="http://www.w3.org/1999/xhtml" class="drawio-native-label"
           style="font-size:${fontSize}px;color:${fontColor};text-align:${align};justify-content:${justify};align-items:${items};">
        ${escapedLabel}
      </div>
    </foreignObject>`;
  }

  _drawioColor(color) {
    if (!color || color === 'none') return 'none';
    return this._escapeHtml(color);
  }

  _styleValue(style, key) {
    const match = style.match(new RegExp(`(?:^|;)${key}=([^;]+)`));
    return match ? match[1] : null;
  }

  _stripHtml(value) {
    const div = document.createElement('div');
    div.innerHTML = value.replace(/<br\s*\/?>/gi, '\n');
    return div.textContent || div.innerText || '';
  }

  _extractDrawioSVG(xml) {
    // draw.io files may embed SVG directly or in diagram elements
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');

    // Check for embedded SVG in the XML
    const svgEl = doc.querySelector('svg');
    if (svgEl) {
      return svgEl.outerHTML;
    }

    return null;
  }

  _renderDrawioFromXML(xml) {
    // Parse the draw.io XML and render diagrams as a visual representation
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const diagrams = doc.querySelectorAll('diagram');

    if (diagrams.length === 0) {
      return '<p class="viewer-info">No diagrams found in this file.</p>';
    }

    let html = '';
    diagrams.forEach((diagram, index) => {
      const name = diagram.getAttribute('name') || `Diagram ${index + 1}`;
      // Try to decode the diagram content (draw.io uses deflate+base64)
      const content = diagram.textContent.trim();
      html += `<div class="drawio-diagram-card">
        <h3>${this._escapeHtml(name)}</h3>`;

      if (content) {
        // Attempt to decode and render
        try {
          const decoded = this._decodeDrawioDiagram(content);
          if (decoded) {
            const cellHtml = this._renderDrawioCells(decoded);
            html += cellHtml;
          } else {
            html += `<p class="viewer-info">Diagram content (encoded). Open in draw.io for full rendering.</p>`;
          }
        } catch {
          html += `<p class="viewer-info">Diagram content (encoded). Open in draw.io for full rendering.</p>`;
        }
      }

      html += '</div>';
    });

    return html;
  }

  _decodeDrawioDiagram(encoded) {
    // draw.io stores diagrams as: base64 → URL-decoded → deflate-compressed XML
    // Or as plain XML in newer formats
    try {
      // Try plain base64 decode first
      const decoded = atob(encoded);
      // Try to decompress (pako/zlib)
      if (window.pako) {
        const inflated = window.pako.inflate(decoded, { to: 'string' });
        return decodeURIComponent(inflated);
      }
      // If no pako, try raw URI decode
      return decodeURIComponent(decoded);
    } catch {
      // May already be plain XML
      if (encoded.startsWith('<')) return encoded;
      return null;
    }
  }

  _renderDrawioCells(xmlString) {
    // Parse the mxGraphModel and render a simplified view of shapes/labels
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');
    const cells = doc.querySelectorAll('mxCell[value]');

    if (cells.length === 0) return '<p class="viewer-info">No labeled elements found.</p>';

    let html = '<div class="drawio-cells">';
    cells.forEach(cell => {
      const value = cell.getAttribute('value');
      if (value && value.trim()) {
        const style = cell.getAttribute('style') || '';
        const isEdge = style.includes('edgeStyle') || cell.getAttribute('edge') === '1';
        const cssClass = isEdge ? 'drawio-edge' : 'drawio-node';
        html += `<span class="${cssClass}">${this._escapeHtml(value)}</span>`;
      }
    });
    html += '</div>';
    return html;
  }

  _escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * Exit viewer mode and restore normal editor layout.
   */
  exitViewerMode() {
    if (document.body.classList.contains('viewer-mode')) {
      this.state._isViewerMode = false;
      this.dom.preview.innerHTML = '';
      // Restore to editor-only
      const body = document.body;
      body.classList.remove('preview-only', 'split-view', 'viewer-mode');
      body.classList.add('editor-only');
      this.dom.previewPane.classList.remove('visible');
      this.state.isPreviewVisible = false;
      this.state.viewMode = 'editor';
    }
  }

  renderMarkdownWithSlides(content) {
    const markdown = window.Frontmatter.strip(content).trim();

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
        if (basePath && !src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('vomit-file://') && !src.startsWith('data:')) {
          resolvedSrc = window.PathUtils.toVomitFileUrl(window.PathUtils.join(basePath, src));
        }
        return `<img src="${resolvedSrc}" alt="${alt}" style="${style}">`;
      }
    );

    processed = processed.replace(
      /!\[([^\]]*)\]\(([^)\s]+)\)/g,
      (match, alt, src) => {
        if (src.includes('=')) return match;
        let resolvedSrc = src;
        if (basePath && !src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('vomit-file://') && !src.startsWith('data:')) {
          resolvedSrc = window.PathUtils.toVomitFileUrl(window.PathUtils.join(basePath, src));
        }
        return `![${alt}](${resolvedSrc})`;
      }
    );

    processed = this.renderWikilinks(processed);

    if (window.marked) {
      return window.marked.parse(processed);
    }
    return this.simpleMarkdown(processed);
  }

  // Convert [[target]] / [[target|alias]] into clickable anchors, leaving any
  // wikilink-looking text inside code spans or fenced blocks untouched.
  renderWikilinks(text) {
    const tokens = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)|\[\[([^\[\]\n]+?)\]\]/g;
    return text.replace(tokens, (match, code, inner) => {
      if (code) return code;
      const pipeIdx = inner.indexOf('|');
      const target = (pipeIdx === -1 ? inner : inner.slice(0, pipeIdx)).trim();
      const label = (pipeIdx === -1 ? inner : inner.slice(pipeIdx + 1)).trim();
      if (!target) return match;
      const safeTarget = target.replace(/"/g, '&quot;');
      return `<a href="#" class="wikilink" data-wikilink="${safeTarget}">${this._escapeHtml(label)}</a>`;
    });
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

    const markdown = window.Frontmatter.strip(content);
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
    let inCodeBlock = false;

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

      // Track fenced code blocks (``` or ~~~)
      if (line.match(/^(`{3,}|~{3,})/)) {
        inCodeBlock = !inCodeBlock;
        return;
      }
      if (inCodeBlock) return;

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

  updateRightOutline() {
    if (!this.state.isRightOutlineVisible) return;

    const content = this.host.cm.getValue();
    const lines = content.split('\n');
    const items = [];
    let slideNum = 1;
    let inFrontmatter = false;
    let inCodeBlock = false;

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

      // Track fenced code blocks (``` or ~~~)
      if (line.match(/^(`{3,}|~{3,})/)) {
        inCodeBlock = !inCodeBlock;
        return;
      }
      if (inCodeBlock) return;

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

    this.dom.rightOutlineList.innerHTML = items.map(item => {
      if (item.type === 'slide') {
        return `<div class="outline-item slide-marker" data-line="${item.line}">${item.text}</div>`;
      }
      return `<div class="outline-item ${item.type}" data-line="${item.line}">${item.text}</div>`;
    }).join('');

    this.dom.rightOutlineList.querySelectorAll('.outline-item').forEach(el => {
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

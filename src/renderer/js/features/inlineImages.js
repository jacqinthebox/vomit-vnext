// InlineImageManager — Shows inline previews in the CodeMirror editor.
// Supports: images, LaTeX (KaTeX), Mermaid diagrams, PlantUML diagrams.
// Uses CM5 line widgets to display rendered content below source.

class InlineImageManager {
  constructor({ state, host }) {
    this.state = state;
    this.host = host;

    // Track widgets: Map<lineNumber, { widget, hash, type }>
    this.widgets = new Map();

    // Mermaid diagram counter for unique IDs
    this.mermaidCounter = 0;

    // Debounce timer
    this._updateTimeout = null;
    this._updateDelay = 200;

    // Feature enabled state
    this._enabled = true;

    // Regex patterns
    this.imagePatternSized = /^!\[([^\]]*)\]\(([^)\s]+)\s*=(\d*)x(\d*)\)\s*$/;
    this.imagePatternSimple = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
  }

  setup() {
    this.host.on('change', () => {
      this.scheduleUpdate();
    });
    window.addEventListener('resize', () => this.updateWidgetWidths());
    this.updateAll();
  }

  scheduleUpdate() {
    clearTimeout(this._updateTimeout);
    this._updateTimeout = setTimeout(() => {
      this.updateAll();
    }, this._updateDelay);
  }

  updateAll() {
    if (!this._enabled) return;

    const content = this.host.getContent();
    const lines = content.split('\n');

    const existingLines = new Set(this.widgets.keys());
    const newWidgetLines = new Set();

    // Find and render all inline content
    this.processImages(lines, newWidgetLines);
    this.processLatexBlocks(lines, newWidgetLines);
    this.processCodeBlocks(lines, newWidgetLines);

    // Remove widgets for deleted content
    for (const lineNum of existingLines) {
      if (!newWidgetLines.has(lineNum)) {
        this.clearWidget(lineNum);
      }
    }
  }

  // --- Images ---
  processImages(lines, newWidgetLines) {
    lines.forEach((lineContent, lineNumber) => {
      const imageMatch = this.parseImageLine(lineContent);
      if (imageMatch) {
        const { src, width, height, alt } = imageMatch;
        const resolvedSrc = this.resolveImagePath(src);
        const hash = this.hashString(lineContent);

        newWidgetLines.add(lineNumber);
        const existing = this.widgets.get(lineNumber);
        if (!existing || existing.hash !== hash) {
          if (existing) existing.widget.clear();
          this.createImageWidget(lineNumber, resolvedSrc, { width, height, alt }, hash);
        }
      }
    });
  }

  parseImageLine(lineContent) {
    let match = lineContent.match(this.imagePatternSized);
    if (match) {
      return {
        alt: match[1],
        src: match[2],
        width: match[3] ? parseInt(match[3], 10) : null,
        height: match[4] ? parseInt(match[4], 10) : null,
      };
    }
    match = lineContent.match(this.imagePatternSimple);
    if (match) {
      return { alt: match[1], src: match[2], width: null, height: null };
    }
    return null;
  }

  resolveImagePath(src) {
    if (
      src.startsWith('http') ||
      src.startsWith('file://') ||
      src.startsWith('vomit-file://') ||
      src.startsWith('data:')
    ) {
      return src;
    }
    const basePath = this.state.basePath;
    if (basePath) {
      return window.PathUtils.toVomitFileUrl(window.PathUtils.join(basePath, src));
    }
    return src;
  }

  createImageWidget(lineNumber, src, { width, height, alt }, hash) {
    const container = document.createElement('div');
    container.className = 'cm-inline-widget cm-image-widget';
    this.constrainWidgetToEditor(container);

    const img = document.createElement('img');
    img.alt = alt || '';
    if (width) img.style.width = `${width}px`;
    if (height) img.style.height = `${height}px`;

    img.onload = () => {
      container.classList.remove('loading');
      this.constrainWidgetToEditor(container);
      this.host.refresh();
    };
    img.onerror = () => {
      container.classList.add('error');
      container.textContent = `Image not found: ${window.PathUtils.basename(src)}`;
    };

    container.appendChild(img);
    img.src = src;

    const widget = this.host.addLineWidget(lineNumber, container, {
      coverGutter: false,
      noHScroll: true,
      above: false,
      handleMouseEvents: true,
    });
    this.widgets.set(lineNumber, { widget, hash, type: 'image' });
  }

  // --- LaTeX Blocks ($$...$$) ---
  processLatexBlocks(lines, newWidgetLines) {
    let inBlock = false;
    let blockStart = -1;
    let blockContent = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!inBlock && line.trim() === '$$') {
        inBlock = true;
        blockStart = i;
        blockContent = [];
      } else if (inBlock && line.trim() === '$$') {
        // End of LaTeX block - render widget after closing $$
        const latex = blockContent.join('\n');
        const hash = this.hashString(latex);

        newWidgetLines.add(i);
        const existing = this.widgets.get(i);
        if (!existing || existing.hash !== hash) {
          if (existing) existing.widget.clear();
          this.createLatexWidget(i, latex, hash);
        }
        inBlock = false;
        blockStart = -1;
      } else if (inBlock) {
        blockContent.push(line);
      }
    }
  }

  createLatexWidget(lineNumber, latex, hash) {
    const container = document.createElement('div');
    container.className = 'cm-inline-widget cm-latex-widget';
    this.constrainWidgetToEditor(container);

    try {
      katex.render(latex, container, {
        displayMode: true,
        throwOnError: false,
        errorColor: '#ef4444',
      });
    } catch (err) {
      container.classList.add('error');
      container.textContent = `LaTeX error: ${err.message}`;
    }

    const widget = this.host.addLineWidget(lineNumber, container, {
      coverGutter: false,
      noHScroll: true,
      above: false,
      handleMouseEvents: true,
    });
    this.widgets.set(lineNumber, { widget, hash, type: 'latex' });
  }

  // --- Code Blocks (mermaid, plantuml) ---
  processCodeBlocks(lines, newWidgetLines) {
    let inBlock = false;
    let blockType = null;
    let blockStart = -1;
    let blockContent = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!inBlock) {
        // Match ```mermaid or ```plantuml (case insensitive, allow leading whitespace)
        const match = line.match(/^\s*```\s*(mermaid|plantuml)\s*$/i);
        if (match) {
          inBlock = true;
          blockType = match[1].toLowerCase();
          blockStart = i;
          blockContent = [];
        }
      } else if (line.match(/^\s*```\s*$/)) {
        // End of code block - render widget after closing ```
        const content = blockContent.join('\n');
        const hash = this.hashString(content + blockType);

        newWidgetLines.add(i);
        const existing = this.widgets.get(i);
        if (!existing || existing.hash !== hash) {
          if (existing) existing.widget.clear();
          if (blockType === 'mermaid') {
            this.createMermaidWidget(i, content, hash);
          } else if (blockType === 'plantuml') {
            this.createPlantUMLWidget(i, content, hash);
          }
        }
        inBlock = false;
        blockType = null;
        blockStart = -1;
      } else if (inBlock) {
        blockContent.push(line);
      }
    }
  }

  createMermaidWidget(lineNumber, content, hash) {
    const container = document.createElement('div');
    container.className = 'cm-inline-widget cm-mermaid-widget';
    this.constrainWidgetToEditor(container);

    const id = `mermaid-editor-${this.mermaidCounter++}`;
    const mermaidDiv = document.createElement('div');
    mermaidDiv.className = 'mermaid';
    mermaidDiv.id = id;
    mermaidDiv.textContent = content;
    container.appendChild(mermaidDiv);

    const widget = this.host.addLineWidget(lineNumber, container, {
      coverGutter: false,
      noHScroll: true,
      above: false,
      handleMouseEvents: true,
    });
    this.widgets.set(lineNumber, { widget, hash, type: 'mermaid' });

    // Render after widget is in DOM
    if (window.mermaid) {
      try {
        window.mermaid.run({ nodes: [mermaidDiv] });
      } catch (err) {
        container.classList.add('error');
        container.textContent = `Mermaid error: ${err.message}`;
      }
    }
  }

  createPlantUMLWidget(lineNumber, content, hash) {
    const container = document.createElement('div');
    container.className = 'cm-inline-widget cm-plantuml-widget';
    this.constrainWidgetToEditor(container);

    // plantumlEncoder is a global from plantuml-encoder.min.js
    const encoder =
      window.plantumlEncoder || (typeof plantumlEncoder !== 'undefined' ? plantumlEncoder : null);

    if (!encoder) {
      container.classList.add('error');
      container.textContent = 'PlantUML encoder not available';
    } else {
      try {
        const encoded = encoder.encode(content.trim());
        const img = document.createElement('img');
        img.src = `https://www.plantuml.com/plantuml/svg/${encoded}`;
        img.alt = 'PlantUML diagram';

        img.onload = () => {
          container.classList.remove('loading');
          this.constrainWidgetToEditor(container);
          this.host.refresh();
        };
        img.onerror = (e) => {
          container.classList.add('error');
          container.textContent = `PlantUML failed - check diagram syntax`;
          console.error('PlantUML error:', img.src, e);
        };

        container.appendChild(img);
      } catch (err) {
        container.classList.add('error');
        container.textContent = `PlantUML error: ${err.message}`;
      }
    }

    const widget = this.host.addLineWidget(lineNumber, container, {
      coverGutter: false,
      noHScroll: true,
      above: false,
      handleMouseEvents: true,
    });
    this.widgets.set(lineNumber, { widget, hash, type: 'plantuml' });
  }

  // --- Utilities ---
  hashString(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  clearWidget(lineNumber) {
    const entry = this.widgets.get(lineNumber);
    if (entry && entry.widget) {
      entry.widget.clear();
    }
    this.widgets.delete(lineNumber);
  }

  clearAllWidgets() {
    for (const [, entry] of this.widgets) {
      if (entry.widget) {
        entry.widget.clear();
      }
    }
    this.widgets.clear();
  }

  widgetMaxWidth() {
    const scroller = this.host.cm?.getScrollerElement?.();
    const available = scroller ? scroller.clientWidth : 0;
    return Math.max(240, available - 96);
  }

  constrainWidgetToEditor(container) {
    const maxWidth = this.widgetMaxWidth();
    container.style.width = `${maxWidth}px`;
    container.style.maxWidth = `${maxWidth}px`;
  }

  updateWidgetWidths() {
    for (const [, entry] of this.widgets) {
      if (entry.widget?.node) {
        this.constrainWidgetToEditor(entry.widget.node);
      }
    }
    this.host.refresh();
  }

  setEnabled(enabled) {
    this._enabled = enabled;
    if (!enabled) {
      this.clearAllWidgets();
    } else {
      this.updateAll();
    }
  }

  toggle() {
    this.setEnabled(!this._enabled);
  }
}

// InlineImageManager — Shows inline image previews in the CodeMirror editor.
// Uses CM5 line widgets to display images below markdown image syntax.

class InlineImageManager {
  constructor({ state, host }) {
    this.state = state;
    this.host = host;

    // Track widgets: Map<lineNumber, { widget, src, hash }>
    this.widgets = new Map();

    // Debounce timer
    this._updateTimeout = null;
    this._updateDelay = 150;

    // Feature enabled state
    this._enabled = true;

    // Regex patterns for image markdown
    // Pattern 1: ![alt](path =WxH) - with dimensions
    this.imagePatternSized = /^!\[([^\]]*)\]\(([^)\s]+)\s*=(\d*)x(\d*)\)\s*$/;
    // Pattern 2: ![alt](path) - simple
    this.imagePatternSimple = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
  }

  setup() {
    // Listen to CM changes
    this.host.on('change', () => {
      this.scheduleUpdate();
    });

    // Initial render
    this.updateImages();
  }

  scheduleUpdate() {
    clearTimeout(this._updateTimeout);
    this._updateTimeout = setTimeout(() => {
      this.updateImages();
    }, this._updateDelay);
  }

  updateImages() {
    if (!this._enabled) return;

    const content = this.host.getContent();
    const lines = content.split('\n');
    const existingLines = new Set(this.widgets.keys());
    const newImageLines = new Set();

    lines.forEach((lineContent, lineNumber) => {
      const imageMatch = this.parseImageLine(lineContent);
      if (imageMatch) {
        newImageLines.add(lineNumber);
        const { src, width, height, alt } = imageMatch;
        const resolvedSrc = this.resolveImagePath(src);
        const hash = this.hashLine(lineContent);

        const existing = this.widgets.get(lineNumber);
        if (!existing || existing.hash !== hash) {
          // Line changed or new - recreate widget
          if (existing) {
            existing.widget.clear();
          }
          this.createWidget(lineNumber, resolvedSrc, { width, height, alt });
          this.widgets.set(lineNumber, {
            widget: this.widgets.get(lineNumber)?.widget,
            src: resolvedSrc,
            hash
          });
        }
      }
    });

    // Remove widgets for deleted image lines
    for (const lineNum of existingLines) {
      if (!newImageLines.has(lineNum)) {
        this.clearWidget(lineNum);
      }
    }
  }

  parseImageLine(lineContent) {
    // Try sized pattern first
    let match = lineContent.match(this.imagePatternSized);
    if (match) {
      return {
        alt: match[1],
        src: match[2],
        width: match[3] ? parseInt(match[3], 10) : null,
        height: match[4] ? parseInt(match[4], 10) : null
      };
    }

    // Try simple pattern
    match = lineContent.match(this.imagePatternSimple);
    if (match) {
      return {
        alt: match[1],
        src: match[2],
        width: null,
        height: null
      };
    }

    return null;
  }

  resolveImagePath(src) {
    // Already absolute or external
    if (src.startsWith('http') || src.startsWith('file://') || src.startsWith('data:')) {
      return src;
    }

    // Resolve relative to basePath
    const basePath = this.state.basePath;
    if (basePath) {
      return `file://${basePath}/${src}`;
    }

    return src;
  }

  hashLine(content) {
    // Simple hash for change detection
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  createWidget(lineNumber, src, { width, height, alt }) {
    const container = document.createElement('div');
    container.className = 'cm-image-widget';

    const img = document.createElement('img');
    img.alt = alt || '';

    // Apply sizing if specified
    if (width) img.style.width = `${width}px`;
    if (height) img.style.height = `${height}px`;

    // Handle load/error
    img.onload = () => {
      container.classList.remove('loading');
    };

    img.onerror = () => {
      container.classList.add('error');
      container.textContent = `Image not found: ${src.split('/').pop()}`;
    };

    container.appendChild(img);
    img.src = src;

    // Add widget below the line
    const widget = this.host.addLineWidget(lineNumber, container, {
      coverGutter: false,
      noHScroll: true,
      above: false,
      handleMouseEvents: true
    });

    this.widgets.set(lineNumber, {
      widget,
      src,
      hash: this.hashLine(this.host.getLine(lineNumber))
    });
  }

  clearWidget(lineNumber) {
    const entry = this.widgets.get(lineNumber);
    if (entry && entry.widget) {
      entry.widget.clear();
    }
    this.widgets.delete(lineNumber);
  }

  clearAllWidgets() {
    for (const [lineNum, entry] of this.widgets) {
      if (entry.widget) {
        entry.widget.clear();
      }
    }
    this.widgets.clear();
  }

  setEnabled(enabled) {
    this._enabled = enabled;
    if (!enabled) {
      this.clearAllWidgets();
    } else {
      this.updateImages();
    }
  }

  toggle() {
    this.setEnabled(!this._enabled);
  }
}

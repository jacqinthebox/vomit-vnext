// CodemirrorHost — Wraps the CodeMirror 5 instance with a clean API.
// Feature modules call host methods instead of touching cm directly.
// This centralizes CM access and makes future CM6 migration easier.

class CodemirrorHost {
  constructor(container, options = {}) {
    this.cm = CodeMirror(container, {
      mode: 'yaml-frontmatter',
      theme: 'default',
      lineNumbers: false,
      lineWrapping: true,
      autofocus: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      extraKeys: options.extraKeys || {},
      placeholder: options.placeholder || ''
    });

    // Highlight [[wikilink]] / [[target|alias]] / [[target#heading]] with the
    // `cm-wikilink` token so styles.css can color them distinctly. This is a
    // pure overlay — it doesn't affect the underlying markdown mode.
    this.cm.addOverlay({
      token: (stream) => {
        if (stream.match(/\[\[[^\[\]\n]+?\]\]/)) {
          return 'wikilink';
        }
        // Advance the stream until we see a potential link or end of line.
        while (stream.next() != null) {
          if (stream.peek() === '[') break;
        }
        return null;
      }
    });

    this._lockHorizontalScroll();
  }

  _lockHorizontalScroll() {
    let pending = false;
    this.cm.on('scroll', (cm) => {
      const info = cm.getScrollInfo();
      if (info.left === 0 || pending) return;

      pending = true;
      requestAnimationFrame(() => {
        const current = cm.getScrollInfo();
        if (current.left !== 0) {
          cm.scrollTo(0, current.top);
        }
        pending = false;
      });
    });
  }

  // --- Content ---
  getContent() {
    return this.cm.getValue();
  }

  setContent(text) {
    this.cm.setValue(text || '');
  }

  // --- Selection & cursor ---
  getSelection() {
    return this.cm.getSelection();
  }

  replaceSelection(text, collapse) {
    this.cm.replaceSelection(text, collapse);
  }

  getCursor(start) {
    return this.cm.getCursor(start);
  }

  setCursor(line, ch) {
    this.cm.setCursor(line, ch);
  }

  getLine(n) {
    return this.cm.getLine(n);
  }

  lineCount() {
    return this.cm.lineCount();
  }

  replaceRange(text, from, to) {
    this.cm.replaceRange(text, from, to);
  }

  getRange(from, to) {
    return this.cm.getRange(from, to);
  }

  setSelection(anchor, head) {
    this.cm.setSelection(anchor, head);
  }

  somethingSelected() {
    return this.cm.somethingSelected();
  }

  // Return the current selection's start/end as { from, to }. Collapses the
  // getCursor('from') / getCursor('to') pair callers otherwise reach for.
  getSelectionRange() {
    return { from: this.cm.getCursor('from'), to: this.cm.getCursor('to') };
  }

  // Move the cursor to the very end of the document.
  setCursorToEnd() {
    const lastLine = this.cm.lastLine();
    this.cm.setCursor({ line: lastLine, ch: this.cm.getLine(lastLine).length });
  }

  // --- Multi-cursor support ---
  listSelections() {
    return this.cm.listSelections();
  }

  setSelections(ranges, primary) {
    this.cm.setSelections(ranges, primary);
  }

  addCursorAbove() {
    const selections = this.cm.listSelections();
    const first = selections[0];
    // Find next non-empty line above
    let newLine = first.head.line - 1;
    while (newLine >= 0 && this.cm.getLine(newLine).trim() === '') {
      newLine--;
    }
    if (newLine >= 0) {
      const lineLen = this.cm.getLine(newLine).length;
      const ch = Math.min(first.head.ch, lineLen);
      const newSelections = [
        { anchor: { line: newLine, ch }, head: { line: newLine, ch } },
        ...selections
      ];
      this.cm.setSelections(newSelections);
    }
  }

  addCursorBelow() {
    const selections = this.cm.listSelections();
    const last = selections[selections.length - 1];
    const lineCount = this.cm.lineCount();
    // Find next non-empty line below
    let newLine = last.head.line + 1;
    while (newLine < lineCount && this.cm.getLine(newLine).trim() === '') {
      newLine++;
    }
    if (newLine < lineCount) {
      const lineLen = this.cm.getLine(newLine).length;
      const ch = Math.min(last.head.ch, lineLen);
      const newSelections = [
        ...selections,
        { anchor: { line: newLine, ch }, head: { line: newLine, ch } }
      ];
      this.cm.setSelections(newSelections);
    }
  }

  clearExtraCursors() {
    const selections = this.cm.listSelections();
    if (selections.length > 1) {
      // Keep only the primary (first) selection
      this.cm.setSelection(selections[0].anchor, selections[0].head);
    }
  }

  // --- Editor state ---
  getHistory() {
    return this.cm.getHistory();
  }

  setHistory(history) {
    this.cm.setHistory(history);
  }

  clearHistory() {
    this.cm.clearHistory();
  }

  getScrollInfo() {
    return this.cm.getScrollInfo();
  }

  scrollTo(x, y) {
    this.cm.scrollTo(0, y);
  }

  scrollIntoView(pos) {
    this.cm.scrollIntoView(pos);
  }

  // --- Options ---
  getOption(key) {
    return this.cm.getOption(key);
  }

  setOption(key, value) {
    this.cm.setOption(key, value);
  }

  // --- Mode ---
  setMode(mode) {
    this.cm.setOption('mode', mode);
  }

  getMode() {
    return this.cm.getOption('mode');
  }

  // --- Focus ---
  focus() {
    this.cm.focus();
  }

  hasFocus() {
    return this.cm.hasFocus();
  }

  // --- Events ---
  on(event, handler) {
    this.cm.on(event, handler);
  }

  off(event, handler) {
    this.cm.off(event, handler);
  }

  // --- Hints ---
  showHint(options) {
    this.cm.showHint(options);
  }

  // --- Refresh ---
  refresh() {
    this.cm.refresh();
  }

  // --- CodeMirror commands (for find/replace) ---
  execCommand(cmd) {
    this.cm.execCommand(cmd);
  }

  // --- Line Widgets ---
  addLineWidget(line, node, options = {}) {
    return this.cm.addLineWidget(line, node, options);
  }

  // --- Gutters ---
  setGutters(ids) {
    this.cm.setOption('gutters', ids || []);
  }

  setGutterMarker(line, gutterId, node) {
    this.cm.setGutterMarker(line, gutterId, node);
  }

  clearGutter(gutterId) {
    this.cm.clearGutter(gutterId);
  }

  lineCount() {
    return this.cm.lineCount();
  }

  // --- Code Block Styling ---
  updateCodeBlockStyles() {
    const lineCount = this.cm.lineCount();
    let inCodeBlock = false;
    let inFrontmatter = false;
    let frontmatterDone = false;

    // Clear copy buttons from the previous pass; they're rebuilt below.
    if (this._codeCopyMarks) {
      this._codeCopyMarks.forEach((mark) => mark.clear());
    }
    this._codeCopyMarks = [];

    for (let i = 0; i < lineCount; i++) {
      const line = this.cm.getLine(i);
      const isFence = /^(`{3,}|~{3,})/.test(line);

      // Frontmatter detection: must start at line 0
      if (!frontmatterDone && line.trim() === '---') {
        if (i === 0) {
          inFrontmatter = true;
          this.cm.addLineClass(i, 'wrap', 'frontmatter-line');
          continue;
        } else if (inFrontmatter) {
          this.cm.addLineClass(i, 'wrap', 'frontmatter-line');
          inFrontmatter = false;
          frontmatterDone = true;
          continue;
        }
      }

      if (inFrontmatter) {
        this.cm.addLineClass(i, 'wrap', 'frontmatter-line');
        this.cm.removeLineClass(i, 'background', 'code-block-line');
        continue;
      }

      // Mark frontmatter as done once we pass a non-frontmatter line at the top
      if (!frontmatterDone && i > 0) {
        frontmatterDone = true;
      }

      this.cm.removeLineClass(i, 'wrap', 'frontmatter-line');

      if (isFence) {
        // Fence line itself gets the style
        this.cm.addLineClass(i, 'background', 'code-block-line');
        // The opening fence (transition into a block) gets a copy button.
        if (!inCodeBlock) {
          this._addCodeCopyButton(i);
        }
        inCodeBlock = !inCodeBlock;
      } else if (inCodeBlock) {
        this.cm.addLineClass(i, 'background', 'code-block-line');
      } else {
        this.cm.removeLineClass(i, 'background', 'code-block-line');
      }
    }
  }

  // Attach a copy-to-clipboard button to the opening fence line of a code
  // block. The button is a bookmark widget, right-aligned via CSS relative to
  // the CodeMirror line. Content is read lazily at click time so it stays in
  // sync as the block is edited.
  _addCodeCopyButton(fenceLine) {
    const btn = document.createElement('span');
    btn.className = 'cm-code-copy-btn';
    btn.title = 'Copy code';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'Copy code');
    btn.contentEditable = 'false';
    btn.innerHTML = this._copyIconSvg();

    btn.addEventListener('mousedown', (e) => {
      // Prevent the editor from stealing focus / moving the cursor.
      e.preventDefault();
      e.stopPropagation();
    });

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = this._getCodeBlockContent(fenceLine);
      try {
        await navigator.clipboard.writeText(code);
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

    const line = this.cm.getLine(fenceLine) || '';
    const mark = this.cm.setBookmark(
      { line: fenceLine, ch: line.length },
      { widget: btn, insertLeft: true }
    );
    this._codeCopyMarks.push(mark);
  }

  // Return the text between the given opening fence line and its matching
  // closing fence (or end of document if unterminated).
  _getCodeBlockContent(fenceLine) {
    const lineCount = this.cm.lineCount();
    const lines = [];
    for (let i = fenceLine + 1; i < lineCount; i++) {
      const line = this.cm.getLine(i);
      if (/^(`{3,}|~{3,})/.test(line)) break;
      lines.push(line);
    }
    return lines.join('\n');
  }

  _copyIconSvg() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  }

  _checkIconSvg() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  }

  // --- Direct access (escape hatch for complex operations) ---
  // Use sparingly — prefer adding a method to the host instead.
  get raw() {
    return this.cm;
  }
}

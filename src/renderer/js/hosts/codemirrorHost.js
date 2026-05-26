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
    this.cm.scrollTo(x, y);
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

  // --- Code Block Styling ---
  updateCodeBlockStyles() {
    const lineCount = this.cm.lineCount();
    let inCodeBlock = false;
    let inFrontmatter = false;
    let frontmatterDone = false;

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
        inCodeBlock = !inCodeBlock;
      } else if (inCodeBlock) {
        this.cm.addLineClass(i, 'background', 'code-block-line');
      } else {
        this.cm.removeLineClass(i, 'background', 'code-block-line');
      }
    }
  }

  // --- Direct access (escape hatch for complex operations) ---
  // Use sparingly — prefer adding a method to the host instead.
  get raw() {
    return this.cm;
  }
}

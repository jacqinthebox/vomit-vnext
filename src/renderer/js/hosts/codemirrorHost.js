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

  // --- Direct access (escape hatch for complex operations) ---
  // Use sparingly — prefer adding a method to the host instead.
  get raw() {
    return this.cm;
  }
}

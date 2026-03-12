// EditorState — Centralized renderer-side state with change notifications.
// Feature modules read state via getters and subscribe via addEventListener.
// Only the orchestrator (editor.js) and TabManager should write state.

class EditorState extends EventTarget {
  constructor() {
    super();

    // File context
    this._currentFilePath = null;
    this._basePath = null;
    this._currentDirectory = null;
    this._projectRoot = null;

    // Editor flags
    this._isDirty = false;
    this._isRestoringTab = false;
    this._autoSaveEnabled = true;

    // View mode
    this._viewMode = 'editor'; // 'editor' | 'split' | 'preview'
    this._isPreviewVisible = false;

    // Sidebar state
    this._isFileTreeVisible = false;
    this._isOutlineVisible = false;
    this._isSearchVisible = false;
    this._focusedPane = 'editor'; // 'editor' | 'sidebar'

    // Terminal state
    this._isTerminalPanelVisible = false;
    this._activeTerminalTab = 'ai'; // 'ai' | 'shell'
    this._isClaudeRunning = false;
    this._isShellRunning = false;

    // File tree cache
    this.expandedFolders = new Set();
    this.treeCache = new Map();

    // Terminal history (mutable arrays, no events needed)
    this.terminalHistory = [];
    this.terminalHistoryIndex = -1;

    // Pseudo state (mutable, no events needed)
    this.pseudoCollecting = false;
    this.pseudoOutput = '';

    // Timing (mutable, no events needed)
    this.searchTimeout = null;
    this.autoSaveTimeout = null;
    this.pendingLineJump = null;
    this.selectedSearchIndex = -1;
  }

  // --- Notification helper ---
  _notify(property, value, oldValue) {
    this.dispatchEvent(new CustomEvent('change', {
      detail: { property, value, oldValue }
    }));
    this.dispatchEvent(new CustomEvent(`change:${property}`, {
      detail: { value, oldValue }
    }));
  }

  // --- File context ---
  get currentFilePath() { return this._currentFilePath; }
  set currentFilePath(v) {
    const old = this._currentFilePath;
    this._currentFilePath = v;
    if (v !== old) this._notify('currentFilePath', v, old);
  }

  get basePath() { return this._basePath; }
  set basePath(v) {
    const old = this._basePath;
    this._basePath = v;
    if (v !== old) this._notify('basePath', v, old);
  }

  get currentDirectory() { return this._currentDirectory; }
  set currentDirectory(v) {
    const old = this._currentDirectory;
    this._currentDirectory = v;
    if (v !== old) this._notify('currentDirectory', v, old);
  }

  get projectRoot() { return this._projectRoot; }
  set projectRoot(v) {
    const old = this._projectRoot;
    this._projectRoot = v;
    if (v !== old) this._notify('projectRoot', v, old);
  }

  // --- Editor flags ---
  get isDirty() { return this._isDirty; }
  set isDirty(v) {
    const old = this._isDirty;
    this._isDirty = !!v;
    if (!!v !== old) this._notify('isDirty', !!v, old);
  }

  get isRestoringTab() { return this._isRestoringTab; }
  set isRestoringTab(v) { this._isRestoringTab = !!v; }

  get autoSaveEnabled() { return this._autoSaveEnabled; }
  set autoSaveEnabled(v) {
    const old = this._autoSaveEnabled;
    this._autoSaveEnabled = !!v;
    if (!!v !== old) this._notify('autoSaveEnabled', !!v, old);
  }

  // --- View mode ---
  get viewMode() { return this._viewMode; }
  set viewMode(v) {
    const old = this._viewMode;
    this._viewMode = v;
    if (v !== old) this._notify('viewMode', v, old);
  }

  get isPreviewVisible() { return this._isPreviewVisible; }
  set isPreviewVisible(v) {
    const old = this._isPreviewVisible;
    this._isPreviewVisible = !!v;
    if (!!v !== old) this._notify('isPreviewVisible', !!v, old);
  }

  // --- Sidebar state ---
  get isFileTreeVisible() { return this._isFileTreeVisible; }
  set isFileTreeVisible(v) {
    const old = this._isFileTreeVisible;
    this._isFileTreeVisible = !!v;
    if (!!v !== old) this._notify('isFileTreeVisible', !!v, old);
  }

  get isOutlineVisible() { return this._isOutlineVisible; }
  set isOutlineVisible(v) {
    const old = this._isOutlineVisible;
    this._isOutlineVisible = !!v;
    if (!!v !== old) this._notify('isOutlineVisible', !!v, old);
  }

  get isSearchVisible() { return this._isSearchVisible; }
  set isSearchVisible(v) {
    const old = this._isSearchVisible;
    this._isSearchVisible = !!v;
    if (!!v !== old) this._notify('isSearchVisible', !!v, old);
  }

  get focusedPane() { return this._focusedPane; }
  set focusedPane(v) {
    const old = this._focusedPane;
    this._focusedPane = v;
    if (v !== old) this._notify('focusedPane', v, old);
  }

  // --- Terminal state ---
  get isTerminalPanelVisible() { return this._isTerminalPanelVisible; }
  set isTerminalPanelVisible(v) {
    const old = this._isTerminalPanelVisible;
    this._isTerminalPanelVisible = !!v;
    if (!!v !== old) this._notify('isTerminalPanelVisible', !!v, old);
  }

  get activeTerminalTab() { return this._activeTerminalTab; }
  set activeTerminalTab(v) {
    const old = this._activeTerminalTab;
    this._activeTerminalTab = v;
    if (v !== old) this._notify('activeTerminalTab', v, old);
  }

  get isClaudeRunning() { return this._isClaudeRunning; }
  set isClaudeRunning(v) {
    const old = this._isClaudeRunning;
    this._isClaudeRunning = !!v;
    if (!!v !== old) this._notify('isClaudeRunning', !!v, old);
  }

  get isShellRunning() { return this._isShellRunning; }
  set isShellRunning(v) {
    const old = this._isShellRunning;
    this._isShellRunning = !!v;
    if (!!v !== old) this._notify('isShellRunning', !!v, old);
  }
}

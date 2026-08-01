const { contextBridge, ipcRenderer } = require('electron');

// Dispatch custom DOM events instead of using callbacks
// This keeps the event handling entirely in the renderer context
ipcRenderer.on('load-content', (event, content, filePath, basePath) => {
  window.dispatchEvent(new CustomEvent('vomit:load-content', { detail: { content, filePath, basePath } }));
});

ipcRenderer.on('request-content', () => {
  window.dispatchEvent(new CustomEvent('vomit:request-content'));
});

ipcRenderer.on('set-theme', (event, theme) => {
  window.dispatchEvent(new CustomEvent('vomit:set-theme', { detail: theme }));
});

ipcRenderer.on('toggle-preview', () => {
  window.dispatchEvent(new CustomEvent('vomit:toggle-preview'));
});

ipcRenderer.on('toggle-outline', () => {
  window.dispatchEvent(new CustomEvent('vomit:toggle-outline'));
});

ipcRenderer.on('toggle-right-outline', () => {
  window.dispatchEvent(new CustomEvent('vomit:toggle-right-outline'));
});

ipcRenderer.on('toggle-wiki-graph', () => {
  window.dispatchEvent(new CustomEvent('vomit:toggle-wiki-graph'));
});

ipcRenderer.on('toggle-files', () => {
  window.dispatchEvent(new CustomEvent('vomit:toggle-files'));
});

ipcRenderer.on('toggle-word-wrap', () => {
  window.dispatchEvent(new CustomEvent('vomit:toggle-word-wrap'));
});

ipcRenderer.on('toggle-search', () => {
  window.dispatchEvent(new CustomEvent('vomit:toggle-search'));
});

ipcRenderer.on('find-in-file', () => {
  window.dispatchEvent(new CustomEvent('vomit:find-in-file'));
});

ipcRenderer.on('find-and-replace', () => {
  window.dispatchEvent(new CustomEvent('vomit:find-and-replace'));
});

ipcRenderer.on('toggle-line-numbers', () => {
  window.dispatchEvent(new CustomEvent('vomit:toggle-line-numbers'));
});

ipcRenderer.on('navigate-parent', () => {
  window.dispatchEvent(new CustomEvent('vomit:navigate-parent'));
});

ipcRenderer.on('show-shortcuts', () => {
  window.dispatchEvent(new CustomEvent('vomit:show-shortcuts'));
});

ipcRenderer.on('show-documentation', (event, content, filePath) => {
  window.dispatchEvent(new CustomEvent('vomit:show-documentation', { detail: { content, filePath } }));
});

// Documentation window events
ipcRenderer.on('load-documentation', (event, content) => {
  window.dispatchEvent(new CustomEvent('vomit:load-documentation', { detail: { content } }));
});

ipcRenderer.on('open-folder', (event, folderPath) => {
  window.dispatchEvent(new CustomEvent('vomit:open-folder', { detail: folderPath }));
});

ipcRenderer.on('refresh-file-tree', (_, detail) => {
  window.dispatchEvent(new CustomEvent('vomit:refresh-file-tree', { detail }));
});

ipcRenderer.on('new-folder', () => {
  window.dispatchEvent(new CustomEvent('vomit:new-folder'));
});

ipcRenderer.on('new-file-inline', (event, targetDir) => {
  window.dispatchEvent(new CustomEvent('vomit:new-file-inline', { detail: targetDir }));
});

ipcRenderer.on('new-presentation-inline', (event, targetDir) => {
  window.dispatchEvent(new CustomEvent('vomit:new-presentation-inline', { detail: targetDir }));
});

ipcRenderer.on('format-command', (event, command) => {
  window.dispatchEvent(new CustomEvent('vomit:format-command', { detail: command }));
});

ipcRenderer.on('load-presentation', (event, content, basePath) => {
  window.dispatchEvent(new CustomEvent('vomit:load-presentation', { detail: { content, basePath } }));
});

ipcRenderer.on('update-content', (event, content) => {
  window.dispatchEvent(new CustomEvent('vomit:update-content', { detail: content }));
});

ipcRenderer.on('navigate-slide', (event, direction) => {
  window.dispatchEvent(new CustomEvent('vomit:navigate-slide', { detail: direction }));
});

ipcRenderer.on('go-to-slide', (event, index) => {
  window.dispatchEvent(new CustomEvent('vomit:go-to-slide', { detail: index }));
});

ipcRenderer.on('render-for-pdf', (event, content, basePath) => {
  window.dispatchEvent(new CustomEvent('vomit:render-for-pdf', { detail: { content, basePath } }));
});

// Tab management events
ipcRenderer.on('new-tab', () => {
  window.dispatchEvent(new CustomEvent('vomit:new-tab'));
});

ipcRenderer.on('close-tab', () => {
  window.dispatchEvent(new CustomEvent('vomit:close-tab'));
});

ipcRenderer.on('close-other-tabs', () => {
  window.dispatchEvent(new CustomEvent('vomit:close-other-tabs'));
});

ipcRenderer.on('next-tab', () => {
  window.dispatchEvent(new CustomEvent('vomit:next-tab'));
});

ipcRenderer.on('prev-tab', () => {
  window.dispatchEvent(new CustomEvent('vomit:prev-tab'));
});

ipcRenderer.on('go-to-tab', (event, tabNumber) => {
  window.dispatchEvent(new CustomEvent('vomit:go-to-tab', { detail: tabNumber }));
});

ipcRenderer.on('toggle-pane-focus', () => {
  window.dispatchEvent(new CustomEvent('vomit:toggle-pane-focus'));
});

ipcRenderer.on('sort-order-changed', (event, order) => {
  window.dispatchEvent(new CustomEvent('vomit:sort-order-changed', { detail: order }));
});

ipcRenderer.on('toggle-tags', () => {
  window.dispatchEvent(new CustomEvent('vomit:toggle-tags'));
});

ipcRenderer.on('toggle-todos', () => {
  window.dispatchEvent(new CustomEvent('vomit:toggle-todos'));
});

// File watching events
ipcRenderer.on('file-changed-externally', (event, filePath) => {
  window.dispatchEvent(new CustomEvent('vomit:file-changed-externally', { detail: filePath }));
});

// Auto-save toggle
ipcRenderer.on('auto-save-changed', (event, enabled) => {
  window.dispatchEvent(new CustomEvent('vomit:auto-save-changed', { detail: enabled }));
});

// Command palette
ipcRenderer.on('show-command-palette', () => {
  window.dispatchEvent(new CustomEvent('vomit:show-command-palette'));
});

// AI Terminal events
ipcRenderer.on('toggle-terminal', () => {
  window.dispatchEvent(new CustomEvent('vomit:toggle-terminal'));
});

ipcRenderer.on('show-terminal', () => {
  window.dispatchEvent(new CustomEvent('vomit:show-terminal'));
});

ipcRenderer.on('claude-output', (event, data) => {
  window.dispatchEvent(new CustomEvent('vomit:claude-output', { detail: data }));
});

// Streamed chain-of-thought from reasoning models — terminal display only,
// never written into documents.
ipcRenderer.on('claude-thinking', (event, data) => {
  window.dispatchEvent(new CustomEvent('vomit:claude-thinking', { detail: data }));
});

ipcRenderer.on('claude-error', (event, data) => {
  window.dispatchEvent(new CustomEvent('vomit:claude-error', { detail: data }));
});

ipcRenderer.on('claude-done', (event, code) => {
  window.dispatchEvent(new CustomEvent('vomit:claude-done', { detail: code }));
});

ipcRenderer.on('claude-metrics', (event, metrics) => {
  window.dispatchEvent(new CustomEvent('vomit:claude-metrics', { detail: metrics }));
});

// Pre-flight/progress notices that must NOT dismiss the thinking indicator
ipcRenderer.on('claude-status', (event, data) => {
  window.dispatchEvent(new CustomEvent('vomit:claude-status', { detail: data }));
});

ipcRenderer.on('agent-permission-request', (event, data) => {
  window.dispatchEvent(new CustomEvent('vomit:agent-permission-request', { detail: data }));
});

ipcRenderer.on('agent-permission-resolved', (event, data) => {
  window.dispatchEvent(new CustomEvent('vomit:agent-permission-resolved', { detail: data }));
});

ipcRenderer.on('git-status-changed', (event, data) => {
  window.dispatchEvent(new CustomEvent('vomit:git-status-changed', { detail: data }));
});

ipcRenderer.on('rag-progress', (event, progress) => {
  window.dispatchEvent(new CustomEvent('vomit:rag-progress', { detail: progress }));
});

ipcRenderer.on('wiki-progress', (event, progress) => {
  window.dispatchEvent(new CustomEvent('vomit:wiki-progress', { detail: progress }));
});

ipcRenderer.on('wiki-changed', (event, data) => {
  window.dispatchEvent(new CustomEvent('vomit:wiki-changed', { detail: data }));
});

ipcRenderer.on('ai-provider-changed', (event, data) => {
  window.dispatchEvent(new CustomEvent('vomit:ai-provider-changed', { detail: data }));
});

ipcRenderer.on('context-stats-updated', () => {
  window.dispatchEvent(new CustomEvent('vomit:context-stats-updated'));
});

ipcRenderer.on('mermaid-curve-changed', (event, curve) => {
  window.dispatchEvent(new CustomEvent('vomit:mermaid-curve-changed', { detail: curve }));
});

ipcRenderer.on('font-size-changed', (event, size) => {
  window.dispatchEvent(new CustomEvent('vomit:font-size-changed', { detail: size }));
});

ipcRenderer.on('file-saved-as', (event, filePath) => {
  window.dispatchEvent(new CustomEvent('vomit:file-saved-as', { detail: filePath }));
});

// Shell Terminal events
ipcRenderer.on('toggle-shell-terminal', () => {
  window.dispatchEvent(new CustomEvent('vomit:toggle-shell-terminal'));
});

ipcRenderer.on('shell-output', (event, data) => {
  window.dispatchEvent(new CustomEvent('vomit:shell-output', { detail: data }));
});

ipcRenderer.on('shell-exit', (event, code) => {
  window.dispatchEvent(new CustomEvent('vomit:shell-exit', { detail: code }));
});

// Pi terminal events
ipcRenderer.on('pi-output', (event, data) => {
  window.dispatchEvent(new CustomEvent('vomit:pi-output', { detail: data }));
});

ipcRenderer.on('pi-exit', (event, code) => {
  window.dispatchEvent(new CustomEvent('vomit:pi-exit', { detail: code }));
});

// Terminal window events
ipcRenderer.on('load-terminal', (event, state) => {
  window.dispatchEvent(new CustomEvent('vomit:load-terminal', { detail: state }));
});

ipcRenderer.on('terminal-detached', () => {
  window.dispatchEvent(new CustomEvent('vomit:terminal-detached'));
});

ipcRenderer.on('terminal-reattached', () => {
  window.dispatchEvent(new CustomEvent('vomit:terminal-reattached'));
});

ipcRenderer.on('terminal-tab-changed', (event, tab) => {
  window.dispatchEvent(new CustomEvent('vomit:terminal-tab-changed', { detail: tab }));
});

ipcRenderer.on('terminal-input-synced', (event, input) => {
  window.dispatchEvent(new CustomEvent('vomit:terminal-input-synced', { detail: input }));
});

ipcRenderer.on('terminal-cleared', () => {
  window.dispatchEvent(new CustomEvent('vomit:terminal-cleared'));
});

ipcRenderer.on('terminal-context-update', (event, ctx) => {
  window.dispatchEvent(new CustomEvent('vomit:terminal-context-update', { detail: ctx }));
});

ipcRenderer.on('execute-detached-command', (event, command) => {
  window.dispatchEvent(new CustomEvent('vomit:execute-detached-command', { detail: command }));
});

// Bucket management events
ipcRenderer.on('bucket-switched', (event, bucket) => {
  window.dispatchEvent(new CustomEvent('vomit:bucket-switched', { detail: bucket }));
});

ipcRenderer.on('file-outside-bucket', (event, filePath) => {
  window.dispatchEvent(new CustomEvent('vomit:file-outside-bucket', { detail: filePath }));
});

ipcRenderer.on('update-available', (event, data) => {
  window.dispatchEvent(new CustomEvent('vomit:update-available', { detail: data }));
});

// Expose only the send methods (no callbacks needed)
contextBridge.exposeInMainWorld('vomit', {
  watchFile: (filePath) => ipcRenderer.send('watch-file', filePath),
  setCurrentFile: (filePath, content) => ipcRenderer.send('set-current-file', filePath, content),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getDirectoryContents: (dirPath) => ipcRenderer.invoke('get-directory-contents', dirPath),
  getFileSortOrder: () => ipcRenderer.invoke('get-file-sort-order'),
  setFileSortOrder: (order) => ipcRenderer.invoke('set-file-sort-order', order),
  getAllTags: () => ipcRenderer.invoke('get-all-tags'),
  getAllTodos: () => ipcRenderer.invoke('get-all-todos'),
  getCurrentDirectory: () => ipcRenderer.invoke('get-current-directory'),
  searchInFiles: (dirPath, query) => ipcRenderer.invoke('search-in-files', dirPath, query),
  renameItem: (oldPath, newName) => ipcRenderer.invoke('rename-item', oldPath, newName),
  deleteItem: (itemPath) => ipcRenderer.invoke('delete-item', itemPath),
  moveItem: (sourcePath, targetDir) => ipcRenderer.invoke('move-item', sourcePath, targetDir),
  showInFinder: (itemPath) => ipcRenderer.invoke('show-in-finder', itemPath),
  openWithDefault: (filePath) => ipcRenderer.invoke('open-with-default', filePath),
  openFile: (filePath) => ipcRenderer.send('open-file-path', filePath),
  saveContent: (content) => ipcRenderer.send('save-content', content),
  contentChanged: (content) => ipcRenderer.send('content-changed', content),
  startPresentation: () => ipcRenderer.send('start-presentation'),
  startPresentationWithPresenter: () => ipcRenderer.send('start-presentation-with-presenter'),
  navigateSlide: (direction) => ipcRenderer.send('navigate-slide', direction),
  goToSlide: (index) => ipcRenderer.send('go-to-slide', index),
  saveImage: (imageData, suggestedName) => ipcRenderer.invoke('save-image', imageData, suggestedName),
  showUnsavedChangesDialog: (filename) => ipcRenderer.invoke('show-unsaved-dialog', filename),
  requestSave: () => ipcRenderer.invoke('request-save'),
  reloadFile: (filePath) => ipcRenderer.invoke('reload-file', filePath),
  getAutoSaveEnabled: () => ipcRenderer.invoke('get-auto-save-enabled'),
  getBucketPath: () => ipcRenderer.invoke('get-bucket-path'),
  newFile: () => ipcRenderer.send('new-file'),
  newPresentation: () => ipcRenderer.send('new-presentation'),
  createPresentationFile: (filePath) => ipcRenderer.invoke('create-presentation-file', filePath),
  openFileDialog: () => ipcRenderer.send('open-file-dialog'),
  saveAs: () => ipcRenderer.send('save-as'),
  exportToPDF: () => ipcRenderer.send('export-to-pdf'),
  setTheme: (theme) => ipcRenderer.send('palette-set-theme', theme),
  setAutoSaveEnabled: (enabled) => ipcRenderer.send('set-auto-save-enabled', enabled),
  showDocumentationWindow: () => ipcRenderer.send('show-documentation-window'),
  showHelp: () => ipcRenderer.send('show-help'),
  // AI CLI methods
  claudeExecute: (command, cwd) => ipcRenderer.invoke('claude-execute', command, cwd),
  claudeStop: () => ipcRenderer.send('claude-stop'),
  claudeClearHistory: () => ipcRenderer.send('claude-clear-history'),
  getAIProvider: () => ipcRenderer.invoke('get-ai-provider'),
  getAIProviderConfig: () => ipcRenderer.invoke('get-ai-provider-config'),
  setAIProviderConfig: (cfg) => ipcRenderer.invoke('set-ai-provider-config', cfg),
  testAIConnection: () => ipcRenderer.invoke('test-ai-connection'),
  getMermaidCurve: () => ipcRenderer.invoke('get-mermaid-curve'),
  getFontSize: () => ipcRenderer.invoke('get-font-size'),
  // Agent mode with tool calling
  agentExecute: (prompt, cwd, opts) => ipcRenderer.invoke('agent-execute', prompt, cwd, opts),
  agentClearHistory: () => ipcRenderer.invoke('agent-clear-history'),
  agentPermissionResponse: (id, answer) => ipcRenderer.invoke('agent-permission-response', { id, answer }),
  // Git awareness
  gitRepoInfo: () => ipcRenderer.invoke('git-repo-info'),
  gitStatus: () => ipcRenderer.invoke('git-status'),
  gitLineDiff: (filePath, content) => ipcRenderer.invoke('git-line-diff', filePath, content),
  getContextStats: () => ipcRenderer.invoke('get-context-stats'),
  onContextStatsUpdated: (cb) => ipcRenderer.on('context-stats-updated', cb),
  // File operations for pseudonymization
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readFileBase64: (filePath) => ipcRenderer.invoke('read-file-base64', filePath),
  readDrawioFile: (filePath) => ipcRenderer.invoke('read-drawio-file', filePath),
  renderDrawioSvg: (filePath) => ipcRenderer.invoke('render-drawio-svg', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  createDirectory: (dirPath) => ipcRenderer.invoke('create-directory', dirPath),
  // Pseudo-repo operations
  pseudoDetectRepos: (bucketPath) => ipcRenderer.invoke('pseudo-detect-repos', bucketPath),
  pseudoHasMapping: (bucketPath) => ipcRenderer.invoke('pseudo-has-mapping', bucketPath),
  pseudoReadMapping: (bucketPath) => ipcRenderer.invoke('pseudo-read-mapping', bucketPath),
  pseudoSaveMapping: (bucketPath, mapping) => ipcRenderer.invoke('pseudo-save-mapping', bucketPath, mapping),
  pseudoSaveProject: (bucketPath, data) => ipcRenderer.invoke('pseudo-save-project', bucketPath, data),
  pseudoReadProject: (bucketPath) => ipcRenderer.invoke('pseudo-read-project', bucketPath),
  pseudoGitInit: (repoPath) => ipcRenderer.invoke('pseudo-git-init', repoPath),
  pseudoGitChangedFiles: (repoPath, hash) => ipcRenderer.invoke('pseudo-git-changed-files', repoPath, hash),
  pseudoCopyStructure: (src, dest) => ipcRenderer.invoke('pseudo-copy-structure', src, dest),
  pseudoRemoveDir: (dirPath) => ipcRenderer.invoke('pseudo-remove-dir', dirPath),
  // RAG methods
  ragIndex: (projectRoot, targetPath) => ipcRenderer.invoke('rag-index', projectRoot, targetPath),
  ragClear: (folderPath) => ipcRenderer.invoke('rag-clear', folderPath),
  ragSearch: (query, folderPath) => ipcRenderer.invoke('rag-search', query, folderPath),
  // Wiki methods
  wikiIndex: (bucketRoot) => ipcRenderer.invoke('wiki-index', bucketRoot),
  okfExport: (bucketRoot) => ipcRenderer.invoke('okf-export', bucketRoot),
  wikiClear: (bucketRoot) => ipcRenderer.invoke('wiki-clear', bucketRoot),
  wikiIndexFile: (bucketRoot, filePath) => ipcRenderer.send('wiki-index-file', bucketRoot, filePath),
  wikiBacklinks: (bucketRoot, targetPath) => ipcRenderer.invoke('wiki-backlinks', bucketRoot, targetPath),
  wikiResolve: (bucketRoot, target, sourcePath) => ipcRenderer.invoke('wiki-resolve', bucketRoot, target, sourcePath),
  wikiListNotes: (bucketRoot) => ipcRenderer.invoke('wiki-list-notes', bucketRoot),
  wikiGraph: (bucketRoot) => ipcRenderer.invoke('wiki-graph', bucketRoot),
  // Shell terminal methods
  shellSpawn: (cwd) => ipcRenderer.invoke('shell-spawn', cwd),
  shellWrite: (data) => ipcRenderer.send('shell-write', data),
  shellResize: (cols, rows) => ipcRenderer.send('shell-resize', cols, rows),
  shellStop: () => ipcRenderer.send('shell-stop'),

  // Pi terminal methods
  piCheck: () => ipcRenderer.invoke('pi-check'),
  piSpawn: (cwd) => ipcRenderer.invoke('pi-spawn', cwd),
  piWrite: (data) => ipcRenderer.send('pi-write', data),
  piResize: (cols, rows) => ipcRenderer.send('pi-resize', cols, rows),
  piStop: () => ipcRenderer.send('pi-stop'),
  piContextUpdate: (ctx) => ipcRenderer.send('pi-context-update', ctx),
  // Bucket management methods
  getBuckets: () => ipcRenderer.invoke('get-buckets'),
  getActiveBucket: () => ipcRenderer.invoke('get-active-bucket'),
  switchBucket: (index) => ipcRenderer.invoke('switch-bucket', index),
  addBucket: () => ipcRenderer.invoke('add-bucket'),
  removeBucket: (index) => ipcRenderer.invoke('remove-bucket', index),
  getTerminalHistory: () => ipcRenderer.invoke('get-terminal-history'),
  setTerminalHistory: (history) => ipcRenderer.invoke('set-terminal-history', history),
  clearTerminalHistory: () => ipcRenderer.invoke('clear-terminal-history'),
  // Terminal window methods
  detachTerminal: (payload) => ipcRenderer.send('detach-terminal', payload),
  reattachTerminal: () => ipcRenderer.send('reattach-terminal'),
  focusTerminalWindow: () => ipcRenderer.send('focus-terminal-window'),
  syncTerminalTab: (tab) => ipcRenderer.send('sync-terminal-tab', tab),
  syncTerminalInput: (input) => ipcRenderer.send('sync-terminal-input', input),
  syncTerminalClear: () => ipcRenderer.send('sync-terminal-clear'),
  syncTerminalContext: (ctx) => ipcRenderer.send('sync-terminal-context', ctx),
  executeInMainTerminal: (command) => ipcRenderer.send('execute-in-main-terminal', command),
  getEditorContent: () => ipcRenderer.invoke('get-editor-content'),
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version')
});

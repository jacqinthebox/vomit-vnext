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

ipcRenderer.on('toggle-files', () => {
  window.dispatchEvent(new CustomEvent('vomit:toggle-files'));
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

ipcRenderer.on('open-folder', (event, folderPath) => {
  window.dispatchEvent(new CustomEvent('vomit:open-folder', { detail: folderPath }));
});

ipcRenderer.on('refresh-file-tree', () => {
  window.dispatchEvent(new CustomEvent('vomit:refresh-file-tree'));
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

ipcRenderer.on('next-tab', () => {
  window.dispatchEvent(new CustomEvent('vomit:next-tab'));
});

ipcRenderer.on('prev-tab', () => {
  window.dispatchEvent(new CustomEvent('vomit:prev-tab'));
});

ipcRenderer.on('go-to-tab', (event, tabNumber) => {
  window.dispatchEvent(new CustomEvent('vomit:go-to-tab', { detail: tabNumber }));
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

ipcRenderer.on('claude-error', (event, data) => {
  window.dispatchEvent(new CustomEvent('vomit:claude-error', { detail: data }));
});

ipcRenderer.on('claude-done', (event, code) => {
  window.dispatchEvent(new CustomEvent('vomit:claude-done', { detail: code }));
});

ipcRenderer.on('rag-progress', (event, progress) => {
  window.dispatchEvent(new CustomEvent('vomit:rag-progress', { detail: progress }));
});

ipcRenderer.on('ai-provider-changed', (event, data) => {
  window.dispatchEvent(new CustomEvent('vomit:ai-provider-changed', { detail: data }));
});

// Expose only the send methods (no callbacks needed)
contextBridge.exposeInMainWorld('vomit', {
  watchFile: (filePath) => ipcRenderer.send('watch-file', filePath),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getDirectoryContents: (dirPath) => ipcRenderer.invoke('get-directory-contents', dirPath),
  getCurrentDirectory: () => ipcRenderer.invoke('get-current-directory'),
  searchInFiles: (dirPath, query) => ipcRenderer.invoke('search-in-files', dirPath, query),
  renameItem: (oldPath, newName) => ipcRenderer.invoke('rename-item', oldPath, newName),
  deleteItem: (itemPath) => ipcRenderer.invoke('delete-item', itemPath),
  showInFinder: (itemPath) => ipcRenderer.invoke('show-in-finder', itemPath),
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
  getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
  hasLastSession: () => ipcRenderer.invoke('has-last-session'),
  newFile: () => ipcRenderer.send('new-file'),
  newPresentation: () => ipcRenderer.send('new-presentation'),
  openFileDialog: () => ipcRenderer.send('open-file-dialog'),
  openFolderDialog: () => ipcRenderer.send('open-folder-dialog'),
  saveAs: () => ipcRenderer.send('save-as'),
  // AI CLI methods
  claudeExecute: (command, cwd) => ipcRenderer.invoke('claude-execute', command, cwd),
  claudeStop: () => ipcRenderer.send('claude-stop'),
  getAIProvider: () => ipcRenderer.invoke('get-ai-provider'),
  // File operations for pseudonymization
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  createDirectory: (dirPath) => ipcRenderer.invoke('create-directory', dirPath),
  // RAG methods
  ragIndex: (projectRoot, targetPath) => ipcRenderer.invoke('rag-index', projectRoot, targetPath),
  ragSearch: (query, folderPath) => ipcRenderer.invoke('rag-search', query, folderPath)
});

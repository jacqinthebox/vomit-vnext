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

ipcRenderer.on('open-folder', (event, folderPath) => {
  window.dispatchEvent(new CustomEvent('vomit:open-folder', { detail: folderPath }));
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

// Expose only the send methods (no callbacks needed)
contextBridge.exposeInMainWorld('vomit', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getDirectoryContents: (dirPath) => ipcRenderer.invoke('get-directory-contents', dirPath),
  getCurrentDirectory: () => ipcRenderer.invoke('get-current-directory'),
  searchInFiles: (dirPath, query) => ipcRenderer.invoke('search-in-files', dirPath, query),
  renameItem: (oldPath, newName) => ipcRenderer.invoke('rename-item', oldPath, newName),
  deleteItem: (itemPath) => ipcRenderer.invoke('delete-item', itemPath),
  openFile: (filePath) => ipcRenderer.send('open-file-path', filePath),
  saveContent: (content) => ipcRenderer.send('save-content', content),
  contentChanged: (content) => ipcRenderer.send('content-changed', content),
  startPresentation: () => ipcRenderer.send('start-presentation'),
  startPresentationWithPresenter: () => ipcRenderer.send('start-presentation-with-presenter'),
  navigateSlide: (direction) => ipcRenderer.send('navigate-slide', direction),
  goToSlide: (index) => ipcRenderer.send('go-to-slide', index),
  saveImage: (imageData, suggestedName) => ipcRenderer.invoke('save-image', imageData, suggestedName)
});

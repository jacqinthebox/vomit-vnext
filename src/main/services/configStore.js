// @ts-check
'use strict';

const Store = require('electron-store');

const store = new Store({
  defaults: {
    theme: 'default',
    lastOpenedFile: null,
    lastOpenedFolder: null,
    autoSaveEnabled: true,
    recentFiles: [],
    ollamaModel: 'llama3.2',
    aiProvider: null
  }
});

const MAX_RECENT_FILES = 10;

/** @returns {string} */
function getTheme() { return store.get('theme'); }
/** @param {string} theme */
function setTheme(theme) { store.set('theme', theme); }

/** @returns {string|null} */
function getLastOpenedFile() { return store.get('lastOpenedFile'); }
/** @param {string|null} filePath */
function setLastOpenedFile(filePath) { store.set('lastOpenedFile', filePath); }

/** @returns {string|null} */
function getLastOpenedFolder() { return store.get('lastOpenedFolder'); }
/** @param {string|null} folderPath */
function setLastOpenedFolder(folderPath) { store.set('lastOpenedFolder', folderPath); }

/** @returns {boolean} */
function getAutoSaveEnabled() { return store.get('autoSaveEnabled'); }
/** @param {boolean} enabled */
function setAutoSaveEnabled(enabled) { store.set('autoSaveEnabled', enabled); }

/** @returns {string[]} */
function getRecentFiles() { return store.get('recentFiles') || []; }
/** @param {string[]} files */
function setRecentFiles(files) { store.set('recentFiles', files); }

/** @returns {string} */
function getOllamaModel() { return store.get('ollamaModel'); }
/** @param {string} model */
function setOllamaModel(model) { store.set('ollamaModel', model); }

/** @returns {string|null} */
function getAIProvider() { return store.get('aiProvider'); }

/**
 * Add a file to the recent files list.
 * @param {string} filePath
 */
function addRecentFile(filePath) {
  if (!filePath) return;
  let recent = getRecentFiles();
  recent = recent.filter(f => f !== filePath);
  recent.unshift(filePath);
  recent = recent.slice(0, MAX_RECENT_FILES);
  setRecentFiles(recent);
}

function clearRecentFiles() {
  setRecentFiles([]);
}

module.exports = {
  getTheme,
  setTheme,
  getLastOpenedFile,
  setLastOpenedFile,
  getLastOpenedFolder,
  setLastOpenedFolder,
  getAutoSaveEnabled,
  setAutoSaveEnabled,
  getRecentFiles,
  setRecentFiles,
  getOllamaModel,
  setOllamaModel,
  getAIProvider,
  addRecentFile,
  clearRecentFiles,
  MAX_RECENT_FILES
};

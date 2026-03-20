// @ts-check
'use strict';

const Store = require('electron-store');

const store = new Store({
  defaults: {
    theme: 'default',
    autoSaveEnabled: true,
    ollamaModel: 'llama3.2',
    aiProvider: null,
    bucketPath: null
  }
});

/** @returns {string} */
function getTheme() { return store.get('theme'); }
/** @param {string} theme */
function setTheme(theme) { store.set('theme', theme); }

/** @returns {boolean} */
function getAutoSaveEnabled() { return store.get('autoSaveEnabled'); }
/** @param {boolean} enabled */
function setAutoSaveEnabled(enabled) { store.set('autoSaveEnabled', enabled); }

/** @returns {string} */
function getOllamaModel() { return store.get('ollamaModel'); }
/** @param {string} model */
function setOllamaModel(model) { store.set('ollamaModel', model); }

/** @returns {string|null} */
function getAIProvider() { return store.get('aiProvider'); }

/** @returns {string|null} */
function getBucketPath() { return store.get('bucketPath'); }
/** @param {string|null} bucketPath */
function setBucketPath(bucketPath) { store.set('bucketPath', bucketPath); }

module.exports = {
  getTheme,
  setTheme,
  getAutoSaveEnabled,
  setAutoSaveEnabled,
  getOllamaModel,
  setOllamaModel,
  getAIProvider,
  getBucketPath,
  setBucketPath
};

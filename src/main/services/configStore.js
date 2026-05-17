// @ts-check
'use strict';

const Store = require('electron-store');
const path = require('path');

const store = new Store({
  defaults: {
    theme: 'default',
    autoSaveEnabled: true,
    ollamaModel: 'llama3.2',
    aiProvider: null,
    bucketPath: null,
    buckets: [],
    activeBucketIndex: 0,
    mermaidCurve: 'linear',
    fontSize: 14,
    tavilyApiKey: ''
  }
});

// Migration: convert legacy single bucketPath to buckets array
function migrateConfig() {
  const buckets = store.get('buckets');
  const legacyPath = store.get('bucketPath');

  if ((!buckets || buckets.length === 0) && legacyPath) {
    const migratedBucket = {
      name: path.basename(legacyPath),
      path: legacyPath
    };
    store.set('buckets', [migratedBucket]);
    store.set('activeBucketIndex', 0);
  }

  if (!store.has('buckets')) {
    store.set('buckets', []);
  }
  if (!store.has('activeBucketIndex')) {
    store.set('activeBucketIndex', 0);
  }
}

migrateConfig();

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

/** @returns {string} */
function getMermaidCurve() { return store.get('mermaidCurve'); }
/** @param {string} curve */
function setMermaidCurve(curve) { store.set('mermaidCurve', curve); }

/** @returns {number} */
function getFontSize() { return store.get('fontSize'); }
/** @param {number} size */
function setFontSize(size) { store.set('fontSize', size); }

/** @returns {string} */
function getTavilyApiKey() { return store.get('tavilyApiKey') || ''; }
/** @param {string} key */
function setTavilyApiKey(key) { store.set('tavilyApiKey', key); }

/** @returns {string} */
function getAIProvider() { return store.get('aiProvider'); }

/** @returns {string|null} Returns active bucket path (backwards compatible) */
function getBucketPath() {
  const activeBucket = getActiveBucket();
  return activeBucket ? activeBucket.path : null;
}
/** @param {string|null} bucketPath @deprecated Use bucket functions instead */
function setBucketPath(bucketPath) { store.set('bucketPath', bucketPath); }

// Bucket management functions

/**
 * @typedef {{ name: string, path: string }} Bucket
 */

/** @returns {Bucket[]} */
function getBuckets() { return store.get('buckets') || []; }

/** @param {Bucket[]} buckets */
function setBuckets(buckets) { store.set('buckets', buckets); }

/** @returns {number} */
function getActiveBucketIndex() { return store.get('activeBucketIndex') || 0; }

/** @param {number} index */
function setActiveBucketIndex(index) { store.set('activeBucketIndex', index); }

/** @returns {Bucket|null} */
function getActiveBucket() {
  const buckets = getBuckets();
  const index = getActiveBucketIndex();
  return buckets[index] || null;
}

/**
 * Add a new bucket
 * @param {Bucket} bucket
 * @returns {number} The index of the new bucket
 */
function addBucket(bucket) {
  const buckets = getBuckets();
  buckets.push(bucket);
  setBuckets(buckets);
  return buckets.length - 1;
}

/**
 * Remove a bucket at index
 * @param {number} index
 * @returns {boolean} True if removed
 */
function removeBucket(index) {
  const buckets = getBuckets();
  if (index < 0 || index >= buckets.length) return false;
  buckets.splice(index, 1);
  setBuckets(buckets);

  // Adjust active index if needed
  const activeIndex = getActiveBucketIndex();
  if (activeIndex >= buckets.length) {
    setActiveBucketIndex(Math.max(0, buckets.length - 1));
  } else if (index < activeIndex) {
    setActiveBucketIndex(activeIndex - 1);
  }
  return true;
}

module.exports = {
  getTheme,
  setTheme,
  getAutoSaveEnabled,
  setAutoSaveEnabled,
  getOllamaModel,
  setOllamaModel,
  getMermaidCurve,
  setMermaidCurve,
  getFontSize,
  setFontSize,
  getAIProvider,
  getTavilyApiKey,
  setTavilyApiKey,
  getBucketPath,
  setBucketPath,
  getBuckets,
  setBuckets,
  getActiveBucketIndex,
  setActiveBucketIndex,
  getActiveBucket,
  addBucket,
  removeBucket
};

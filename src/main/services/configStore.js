// @ts-check
'use strict';

const ElectronStore = require('electron-store');
const Store = ElectronStore.default || ElectronStore;
const path = require('path');

const store = new Store({
  defaults: {
    theme: 'default',
    autoSaveEnabled: true,
    ollamaModel: 'llama3.2',
    aiProvider: 'ollama',
    // Legacy single-endpoint fields. Kept as defaults for new endpoints and
    // as a fallback when no endpoints are configured yet.
    openaiBaseUrl: 'http://127.0.0.1:8000/v1',
    openaiApiKey: 'dummy',
    openaiModel: '',
    // Multi-endpoint list. Each entry: { name, baseUrl, apiKey, model }.
    openaiEndpoints: [],
    activeOpenaiEndpointIndex: 0,
    bucketPath: null,
    buckets: [],
    activeBucketIndex: 0,
    mermaidCurve: 'linear',
    fontSize: 14,
    tavilyApiKey: '',
    showImagesFolder: false,
    fileSortOrder: 'name',
    // Agent tool permission mode: 'auto' (auto-allow read-only tools),
    // 'always' (prompt for every tool), 'never' (no prompts).
    agentPermissionMode: 'auto',
    // Show a unified diff for agent file writes/edits instead of the plain
    // permission prompt. When off, writes fall back to the plain prompt.
    agentDiffGate: true,
    // Max output tokens for OpenAI-compatible chat completions.
    openaiMaxTokens: 4096
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

  // Migration: if user previously configured a single OpenAI-compatible
  // endpoint (i.e. they set openaiModel) and we don't yet have a list,
  // promote the legacy single-field settings into the new endpoints array.
  const endpoints = store.get('openaiEndpoints');
  const legacyModel = store.get('openaiModel');
  if ((!endpoints || endpoints.length === 0) && legacyModel) {
    const legacyBaseUrl = store.get('openaiBaseUrl') || 'http://127.0.0.1:8000/v1';
    const legacyApiKey = store.get('openaiApiKey') || 'dummy';
    store.set('openaiEndpoints', [{
      name: deriveEndpointName(legacyBaseUrl, legacyModel),
      baseUrl: legacyBaseUrl,
      apiKey: legacyApiKey,
      model: legacyModel
    }]);
    store.set('activeOpenaiEndpointIndex', 0);
  }
}

// Pick a friendly default name when the user doesn't provide one.
function deriveEndpointName(baseUrl, model) {
  if (model) {
    const tail = String(model).split('/').pop();
    return tail || model;
  }
  try {
    return new URL(baseUrl).host;
  } catch (_) {
    return baseUrl || 'endpoint';
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

const AGENT_PERMISSION_MODES = ['auto', 'always', 'never'];
/** @returns {string} 'auto' | 'always' | 'never' */
function getAgentPermissionMode() {
  const v = store.get('agentPermissionMode');
  return AGENT_PERMISSION_MODES.includes(v) ? v : 'auto';
}
/** @param {string} mode */
function setAgentPermissionMode(mode) {
  store.set('agentPermissionMode', AGENT_PERMISSION_MODES.includes(mode) ? mode : 'auto');
}

/** @returns {boolean} */
function getAgentDiffGate() { return store.get('agentDiffGate') !== false; }
/** @param {boolean} enabled */
function setAgentDiffGate(enabled) { store.set('agentDiffGate', enabled !== false); }

/** @returns {number} */
function getOpenAIMaxTokens() {
  const v = store.get('openaiMaxTokens');
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4096;
}
/** @param {number} n */
function setOpenAIMaxTokens(n) {
  const value = Number.isFinite(n) && n > 0 ? Math.floor(n) : 4096;
  store.set('openaiMaxTokens', value);
}

/** @returns {string} */
function getTavilyApiKey() { return store.get('tavilyApiKey') || ''; }
/** @param {string} key */
function setTavilyApiKey(key) { store.set('tavilyApiKey', key); }

/** @returns {boolean} */
function getShowImagesFolder() { return store.get('showImagesFolder') === true; }
/** @param {boolean} value */
function setShowImagesFolder(value) { store.set('showImagesFolder', value); }

/** @returns {string} 'name' or 'modified' */
function getFileSortOrder() { return store.get('fileSortOrder') || 'name'; }
/** @param {string} order */
function setFileSortOrder(order) { store.set('fileSortOrder', order); }

const TERMINAL_HISTORY_MAX = 100;
/** @returns {string[]} */
function getTerminalHistory() { return store.get('terminalHistory') || []; }
/** @param {string[]} history */
function setTerminalHistory(history) { store.set('terminalHistory', history.slice(-TERMINAL_HISTORY_MAX)); }
function clearTerminalHistory() { store.set('terminalHistory', []); }

/** @returns {string} */
function getAIProvider() {
  const v = store.get('aiProvider');
  return v === 'openai-compatible' ? 'openai-compatible' : 'ollama';
}
/** @param {string} provider 'ollama' | 'openai-compatible' */
function setAIProvider(provider) {
  const normalized = provider === 'openai-compatible' ? 'openai-compatible' : 'ollama';
  store.set('aiProvider', normalized);
}

// --- OpenAI-compatible endpoints (multi) ---

/**
 * @typedef {{ name: string, baseUrl: string, apiKey: string, model: string, contextLength?: number }} OpenAIEndpoint
 */

/** @returns {OpenAIEndpoint[]} */
function getOpenAIEndpoints() { return store.get('openaiEndpoints') || []; }
/** @param {OpenAIEndpoint[]} list */
function setOpenAIEndpoints(list) { store.set('openaiEndpoints', list || []); }

/** @returns {number} */
function getActiveOpenAIEndpointIndex() {
  const idx = store.get('activeOpenaiEndpointIndex');
  return typeof idx === 'number' ? idx : 0;
}
/** @param {number} index */
function setActiveOpenAIEndpointIndex(index) {
  store.set('activeOpenaiEndpointIndex', index);
}

/** @returns {OpenAIEndpoint|null} */
function getActiveOpenAIEndpoint() {
  const list = getOpenAIEndpoints();
  const idx = getActiveOpenAIEndpointIndex();
  return list[idx] || null;
}

/**
 * Add a new endpoint and return its index.
 * @param {OpenAIEndpoint} ep
 * @returns {number}
 */
function addOpenAIEndpoint(ep) {
  const list = getOpenAIEndpoints();
  const entry = {
    name: ep.name || deriveEndpointName(ep.baseUrl, ep.model),
    baseUrl: ep.baseUrl || '',
    apiKey: ep.apiKey || '',
    model: ep.model || ''
  };
  if (typeof ep.contextLength === 'number' && ep.contextLength > 0) {
    entry.contextLength = ep.contextLength;
  }
  list.push(entry);
  setOpenAIEndpoints(list);
  return list.length - 1;
}

/**
 * Update the endpoint at index in place. Unknown fields are ignored.
 * @param {number} index
 * @param {Partial<OpenAIEndpoint>} patch
 * @returns {boolean}
 */
function updateOpenAIEndpoint(index, patch) {
  const list = getOpenAIEndpoints();
  if (index < 0 || index >= list.length) return false;
  const current = list[index];
  const next = {
    name: typeof patch.name === 'string' ? patch.name : current.name,
    baseUrl: typeof patch.baseUrl === 'string' ? patch.baseUrl : current.baseUrl,
    apiKey: typeof patch.apiKey === 'string' ? patch.apiKey : current.apiKey,
    model: typeof patch.model === 'string' ? patch.model : current.model
  };
  // contextLength is optional. Patch may set a positive number, omit it
  // (keep current), or set 0/null to clear it.
  if (Object.prototype.hasOwnProperty.call(patch, 'contextLength')) {
    if (typeof patch.contextLength === 'number' && patch.contextLength > 0) {
      next.contextLength = patch.contextLength;
    }
  } else if (typeof current.contextLength === 'number' && current.contextLength > 0) {
    next.contextLength = current.contextLength;
  }
  list[index] = next;
  setOpenAIEndpoints(list);
  return true;
}

/**
 * Remove the endpoint at index, adjusting the active index if needed.
 * @param {number} index
 * @returns {boolean}
 */
function removeOpenAIEndpoint(index) {
  const list = getOpenAIEndpoints();
  if (index < 0 || index >= list.length) return false;
  list.splice(index, 1);
  setOpenAIEndpoints(list);
  const active = getActiveOpenAIEndpointIndex();
  if (active >= list.length) setActiveOpenAIEndpointIndex(Math.max(0, list.length - 1));
  else if (index < active) setActiveOpenAIEndpointIndex(active - 1);
  return true;
}

// --- Legacy single-endpoint API (read-through to the active endpoint) ---
// These keep the rest of the codebase (aiProviders, IPC handlers, menu)
// working unchanged. When there's no active endpoint, fall back to the
// legacy single-field store so the "Add endpoint…" dialog can pre-fill.

/** @returns {string} */
function getOpenAIBaseUrl() {
  const ep = getActiveOpenAIEndpoint();
  return ep ? ep.baseUrl : (store.get('openaiBaseUrl') || 'http://127.0.0.1:8000/v1');
}
/** @param {string} url */
function setOpenAIBaseUrl(url) {
  const ep = getActiveOpenAIEndpoint();
  if (ep) updateOpenAIEndpoint(getActiveOpenAIEndpointIndex(), { baseUrl: url });
  else store.set('openaiBaseUrl', url);
}

/** @returns {string} */
function getOpenAIApiKey() {
  const ep = getActiveOpenAIEndpoint();
  return ep ? (ep.apiKey || '') : (store.get('openaiApiKey') || '');
}
/** @param {string} key */
function setOpenAIApiKey(key) {
  const ep = getActiveOpenAIEndpoint();
  if (ep) updateOpenAIEndpoint(getActiveOpenAIEndpointIndex(), { apiKey: key });
  else store.set('openaiApiKey', key);
}

/** @returns {string} */
function getOpenAIModel() {
  const ep = getActiveOpenAIEndpoint();
  return ep ? (ep.model || '') : (store.get('openaiModel') || '');
}
/** @param {string} model */
function setOpenAIModel(model) {
  const ep = getActiveOpenAIEndpoint();
  if (ep) updateOpenAIEndpoint(getActiveOpenAIEndpointIndex(), { model });
  else store.set('openaiModel', model);
}

/** @returns {string} Active model id for whichever provider is selected. */
function getActiveModel() {
  return getAIProvider() === 'openai-compatible' ? getOpenAIModel() : getOllamaModel();
}

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
  setAIProvider,
  getOpenAIBaseUrl,
  setOpenAIBaseUrl,
  getOpenAIApiKey,
  setOpenAIApiKey,
  getOpenAIModel,
  setOpenAIModel,
  getOpenAIEndpoints,
  setOpenAIEndpoints,
  getActiveOpenAIEndpoint,
  getActiveOpenAIEndpointIndex,
  setActiveOpenAIEndpointIndex,
  addOpenAIEndpoint,
  updateOpenAIEndpoint,
  removeOpenAIEndpoint,
  getActiveModel,
  getAgentPermissionMode,
  setAgentPermissionMode,
  getAgentDiffGate,
  setAgentDiffGate,
  getOpenAIMaxTokens,
  setOpenAIMaxTokens,
  getTavilyApiKey,
  setTavilyApiKey,
  getShowImagesFolder,
  setShowImagesFolder,
  getFileSortOrder,
  setFileSortOrder,
  getTerminalHistory,
  setTerminalHistory,
  clearTerminalHistory,
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

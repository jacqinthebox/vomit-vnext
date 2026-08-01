// @ts-check
'use strict';

/**
 * Model context-length detection, shared by the get-context-stats IPC handler
 * and the token-aware history trimmer in the agent loop.
 *
 * - Ollama: POST /api/show and look for a *context_length key in model_info.
 * - OpenAI-compatible: GET /v1/models and look for max_model_len /
 *   context_length / context_window, falling back to the user-configured
 *   endpoint contextLength, then a 32k default.
 */

const http = require('http');

const DEFAULT_CONTEXT_LIMIT = 32768;

// Cache for model context lengths (keyed by model / endpoint+model)
const modelContextCache = {};

/** @param {string} modelName */
function getOllamaModelContextLength(modelName) {
  if (modelContextCache[modelName]) return Promise.resolve(modelContextCache[modelName]);
  const requestBody = JSON.stringify({ name: modelName });
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 11434,
        path: '/api/show',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const info = json.model_info || {};
            for (const key of Object.keys(info)) {
              if (key.toLowerCase().includes('context_length')) {
                modelContextCache[modelName] = info[key];
                resolve(info[key]);
                return;
              }
            }
            resolve(DEFAULT_CONTEXT_LIMIT);
          } catch (_) {
            resolve(DEFAULT_CONTEXT_LIMIT);
          }
        });
      },
    );
    req.on('error', () => resolve(DEFAULT_CONTEXT_LIMIT));
    req.write(requestBody);
    req.end();
  });
}

/**
 * Query an OpenAI-compatible /v1/models endpoint for context length.
 * MLX and many other servers expose this as `max_model_len` or similar.
 * @param {string} baseUrl
 * @param {string} modelName
 * @returns {Promise<number|null>}
 */
function getOpenAIModelContextLength(baseUrl, modelName) {
  const cacheKey = `openai:${baseUrl}:${modelName}`;
  if (modelContextCache[cacheKey]) return Promise.resolve(modelContextCache[cacheKey]);
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL('/v1/models', baseUrl);
    } catch (_) {
      resolve(null);
      return;
    }
    const mod = url.protocol === 'https:' ? require('https') : http;
    const req = mod.request(url, { method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const models = json.data || [];
          const match = models.find((m) => m.id === modelName);
          if (match) {
            const ctx = match.max_model_len || match.context_length || match.context_window;
            if (ctx && typeof ctx === 'number' && ctx > 0) {
              modelContextCache[cacheKey] = ctx;
              resolve(ctx);
              return;
            }
          }
          resolve(null);
        } catch (_) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

/**
 * Resolve the context limit for the active provider/model.
 * @param {typeof import('./configStore')} configStore
 * @returns {Promise<number>}
 */
async function getContextLimit(configStore) {
  const model = configStore.getActiveModel();
  if (configStore.getAIProvider() === 'ollama') {
    return model ? getOllamaModelContextLength(model) : DEFAULT_CONTEXT_LIMIT;
  }
  const ep = configStore.getActiveOpenAIEndpoint();
  const baseUrl = ep && ep.baseUrl;
  const detected = baseUrl && model ? await getOpenAIModelContextLength(baseUrl, model) : null;
  if (detected) return detected;
  if (ep && typeof ep.contextLength === 'number' && ep.contextLength > 0) return ep.contextLength;
  return DEFAULT_CONTEXT_LIMIT;
}

/**
 * The context window actually in effect for requests: for Ollama this is the
 * configured num_ctx capped by the model's maximum (Ollama serves 4096 by
 * default no matter what the model supports, so we must request more and the
 * history budget / context bar must reflect what we request, not the max).
 * @param {typeof import('./configStore')} configStore
 * @returns {Promise<number>}
 */
async function getEffectiveContextLimit(configStore) {
  const max = await getContextLimit(configStore);
  if (
    configStore.getAIProvider() === 'ollama' &&
    typeof configStore.getOllamaNumCtx === 'function'
  ) {
    return Math.min(max, configStore.getOllamaNumCtx());
  }
  return max;
}

module.exports = {
  getContextLimit,
  getEffectiveContextLimit,
  getOllamaModelContextLength,
  getOpenAIModelContextLength,
  DEFAULT_CONTEXT_LIMIT,
};

// @ts-check
'use strict';

/**
 * Provider-agnostic AI chat client.
 *
 * Supported providers:
 *   - 'ollama'             → POST {host}/api/chat  (Ollama native streaming)
 *   - 'openai-compatible'  → POST {baseUrl}/chat/completions
 *                            (OpenAI Chat Completions, e.g. mlx_lm.server,
 *                             vLLM, LM Studio, llama.cpp's --api-server, etc.)
 *
 * Embeddings still live in src/main/rag.js and currently use Ollama directly;
 * the OpenAI-compatible provider only handles chat/agent flows.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PROVIDER_OLLAMA = 'ollama';
const PROVIDER_OPENAI = 'openai-compatible';

const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';

/**
 * Resolve the active provider configuration from the config store.
 * @param {typeof import('./configStore')} configStore
 * @returns {{ provider: string, baseUrl: string, apiKey: string, model: string }}
 */
function getActiveProviderConfig(configStore) {
  const stored = configStore.getAIProvider();
  const provider = stored === PROVIDER_OPENAI ? PROVIDER_OPENAI : PROVIDER_OLLAMA;

  if (provider === PROVIDER_OPENAI) {
    return {
      provider,
      baseUrl: configStore.getOpenAIBaseUrl(),
      apiKey: configStore.getOpenAIApiKey(),
      model: configStore.getOpenAIModel() || ''
    };
  }
  return {
    provider,
    baseUrl: OLLAMA_DEFAULT_URL,
    apiKey: '',
    model: configStore.getOllamaModel() || ''
  };
}

function pickHttpModule(parsedUrl) {
  return parsedUrl.protocol === 'https:' ? https : http;
}

/**
 * Build request options for http(s).request from a URL object.
 * Trailing slashes on the path are preserved.
 */
function buildRequestOptions(urlObj, method, headers) {
  return {
    protocol: urlObj.protocol,
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method,
    headers
  };
}

function contentToText(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(contentToText).join('');
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    if (typeof value.value === 'string') return value.value;
  }
  return '';
}

function parseErrorBody(body) {
  if (!body) return '';
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.error === 'string') return parsed.error;
  } catch (_) {
    // Fall through to the raw response body.
  }
  return String(body);
}

function formatOllamaApiError(statusCode, body) {
  const details = parseErrorBody(body);
  const lower = details.toLowerCase();
  if (lower.includes('llama-server binary not found')) {
    const repairSteps = process.platform === 'darwin'
      ? [
          'brew reinstall ollama',
          'brew services restart ollama'
        ]
      : process.platform === 'win32'
        ? [
            'Repair or reinstall Ollama from https://ollama.com/download',
            'Restart the Ollama app'
          ]
        : [
            'Reinstall Ollama from https://ollama.com/download',
            'Restart the Ollama service'
          ];
    return [
      'Ollama is installed but cannot start models because its llama-server helper is missing.',
      'Repair the local Ollama install with:',
      '',
      ...repairSteps,
      '',
      'Then run: ollama list',
      '',
      `Details: ${details}`
    ].join('\n');
  }

  return `Ollama API error: ${statusCode} - ${body}`;
}

/**
 * Stream a chat completion from the active provider.
 *
 * The returned assistant message is normalized so callers always see the
 * Ollama-style shape: `{ role: 'assistant', content, tool_calls? }`, where
 * each tool call has `{ id?, function: { name, arguments } }` and arguments
 * is a parsed object (already JSON-decoded). This keeps agent.js code provider
 * agnostic.
 *
 * @param {Object} opts
 * @param {string} opts.provider              'ollama' | 'openai-compatible'
 * @param {string} opts.baseUrl               e.g. 'http://127.0.0.1:11434' or 'http://127.0.0.1:8000/v1'
 * @param {string} [opts.apiKey]              Bearer token for OpenAI-compatible
 * @param {string} opts.model                 model id
 * @param {Array<object>} opts.messages
 * @param {Array<object>} [opts.tools]
 * @param {(chunk: string) => void} [opts.onContent]   Called for each streamed content chunk
 * @param {() => boolean} [opts.isAborted]    If returns true, request is dropped
 * @param {(req: import('http').ClientRequest) => void} [opts.onRequest] Receives the underlying request for abort handling
 * @returns {Promise<{role: 'assistant', content: string, tool_calls?: Array<{id?: string, function: {name: string, arguments: any}}>}>}
 */
function streamChat(opts) {
  if (opts.provider === PROVIDER_OPENAI) {
    return streamOpenAIChat(opts);
  }
  return streamOllamaChat(opts);
}

function streamOllamaChat({ baseUrl, model, messages, tools, onContent, isAborted, onRequest }) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/chat', baseUrl || OLLAMA_DEFAULT_URL);
    const body = JSON.stringify({
      model,
      messages,
      tools,
      stream: true
    });

    const req = pickHttpModule(url).request(
      buildRequestOptions(url, 'POST', {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }),
      (res) => {
        if (res.statusCode !== 200) {
          let errBody = '';
          res.on('data', (c) => (errBody += c));
          res.on('end', () => {
            if (res.statusCode === 400) {
              reject(new Error(`Model may not support tool calling. Try llama3.2, llama3.1, mistral, or qwen2.5.\n\nDetails: ${errBody}`));
            } else {
              reject(new Error(formatOllamaApiError(res.statusCode, errBody)));
            }
          });
          return;
        }

        res.setEncoding('utf8');
        let buffer = '';
        let content = '';
        let toolCalls = null;

        const handleLine = (line) => {
          if (!line.trim()) return;
          try {
            const json = JSON.parse(line);
            if (json.message && json.message.content) {
              const text = contentToText(json.message.content);
              if (text) {
                content += text;
                if (onContent) onContent(text);
              }
            }
            if (json.message && json.message.tool_calls) {
              toolCalls = json.message.tool_calls;
            }
          } catch (_) {
            // Ignore partial JSON
          }
        };

        res.on('data', (chunk) => {
          if (isAborted && isAborted()) return;
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) handleLine(line);
        });

        res.on('end', () => {
          if (buffer.trim()) handleLine(buffer);
          resolve({
            role: 'assistant',
            content,
            tool_calls: toolCalls || undefined
          });
        });
      }
    );

    req.on('error', (err) => {
      reject(new Error(`Connection error: ${err.message}\nMake sure Ollama is running: ollama serve`));
    });

    if (onRequest) onRequest(req);
    req.write(body);
    req.end();
  });
}

function streamOpenAIChat({ baseUrl, apiKey, model, messages, tools, onContent, isAborted, onRequest }) {
  return new Promise((resolve, reject) => {
    if (!baseUrl) {
      reject(new Error('OpenAI-compatible base URL is not configured. Set it via AI menu → Configure OpenAI-Compatible Endpoint…'));
      return;
    }

    // Ensure the path ends correctly. baseUrl typically already includes '/v1'
    // (e.g. http://127.0.0.1:8000/v1). We append '/chat/completions'.
    const trimmed = baseUrl.replace(/\/+$/, '');
    const url = new URL(trimmed + '/chat/completions');

    const payload = {
      model,
      messages: messages.map(toOpenAIMessage),
      stream: true,
      // Reasoning models (Gemma 4, DeepSeek-R1, etc.) can spend hundreds of
      // tokens on chain-of-thought before producing any user-visible content.
      // The OpenAI spec defaults to a relatively small cap that some servers
      // (notably mlx_lm.server, default 512) honour, which can starve the
      // model before it ever emits real output. Allow a generous budget.
      max_tokens: 4096
    };
    if (tools && tools.length) payload.tools = tools;

    const body = JSON.stringify(payload);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Accept': 'text/event-stream'
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const req = pickHttpModule(url).request(buildRequestOptions(url, 'POST', headers), (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', (c) => (errBody += c));
        res.on('end', () => {
          reject(new Error(`OpenAI-compatible API error: ${res.statusCode} - ${errBody}`));
        });
        return;
      }

      res.setEncoding('utf8');
      let buffer = '';
      let content = '';
      // Tool calls are streamed as deltas indexed by .index. We rebuild them
      // and only emit if any function names are present.
      /** @type {Map<number, {id?: string, name: string, arguments: string}>} */
      const toolBuilder = new Map();
      // Reasoning-mode tracking: models like Gemma 4 / DeepSeek-R1 stream
      // their chain-of-thought via delta.reasoning before emitting any
      // delta.content. We surface it to the user so they see progress, but
      // we never include it in the assistant message that goes back into
      // conversation history — otherwise every subsequent turn would carry
      // the previous turn's reasoning forward and blow up context.
      let inReasoning = false;

      const handleEvent = (dataLine) => {
        const trimmed = dataLine.trim();
        if (!trimmed) return;
        if (trimmed === '[DONE]') return;
        try {
          const json = JSON.parse(trimmed);
          const choice = json.choices && json.choices[0];
          if (!choice) return;
          const delta = choice.delta || {};
          if (typeof delta.reasoning === 'string' && delta.reasoning.length) {
            if (!inReasoning) {
              inReasoning = true;
              if (onContent) onContent('💭 ');
            }
            if (onContent) onContent(delta.reasoning);
          }
          const deltaContent = contentToText(delta.content);
          if (deltaContent.length) {
            if (inReasoning) {
              inReasoning = false;
              if (onContent) onContent('\n\n');
            }
            content += deltaContent;
            if (onContent) onContent(deltaContent);
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = typeof tc.index === 'number' ? tc.index : 0;
              let acc = toolBuilder.get(idx);
              if (!acc) {
                acc = { id: tc.id, name: '', arguments: '' };
                toolBuilder.set(idx, acc);
              }
              if (tc.id) acc.id = tc.id;
              if (tc.function) {
                if (tc.function.name) acc.name += tc.function.name;
                if (typeof tc.function.arguments === 'string') acc.arguments += tc.function.arguments;
              }
            }
          }
        } catch (_) {
          // Skip malformed lines
        }
      };

      res.on('data', (chunk) => {
        if (isAborted && isAborted()) return;
        buffer += chunk;
        // SSE: events are separated by blank lines; each event has zero or more
        // `data: ...` lines. We process line-by-line and only look at data:.
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, '');
          if (line.startsWith('data:')) handleEvent(line.slice(5));
        }
      });

      res.on('end', () => {
        if (buffer.trim()) {
          for (const rawLine of buffer.split('\n')) {
            const line = rawLine.replace(/\r$/, '');
            if (line.startsWith('data:')) handleEvent(line.slice(5));
          }
        }

        const toolCalls = [];
        for (const acc of toolBuilder.values()) {
          if (!acc.name) continue;
          let parsedArgs = {};
          if (acc.arguments) {
            try { parsedArgs = JSON.parse(acc.arguments); }
            catch (_) { parsedArgs = { _raw: acc.arguments }; }
          }
          toolCalls.push({
            id: acc.id,
            function: { name: acc.name, arguments: parsedArgs }
          });
        }

        resolve({
          role: 'assistant',
          content,
          tool_calls: toolCalls.length ? toolCalls : undefined
        });
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Connection error to ${baseUrl}: ${err.message}\nMake sure your OpenAI-compatible server is running.`));
    });

    if (onRequest) onRequest(req);
    req.write(body);
    req.end();
  });
}

/**
 * Translate one of our internal messages into the OpenAI message shape.
 * - assistant tool_calls need to be serialized with stringified arguments.
 * - tool result messages need a tool_call_id.
 */
function toOpenAIMessage(msg) {
  if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    return {
      role: 'assistant',
      content: contentToText(msg.content),
      tool_calls: msg.tool_calls.map((tc, i) => ({
        id: tc.id || `call_${i}`,
        type: 'function',
        function: {
          name: tc.function?.name,
          arguments: typeof tc.function?.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments || {})
        }
      }))
    };
  }
  if (msg.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: msg.tool_call_id || 'call_0',
      content: contentToText(msg.content)
    };
  }
  return { role: msg.role, content: contentToText(msg.content) };
}

/**
 * Build a tool-result message in the shape required by the active provider.
 * Ollama accepts `{ role: 'tool', content }`; OpenAI requires `tool_call_id`.
 * @param {string} provider
 * @param {{id?: string, function: {name: string}}} toolCall
 * @param {string} content
 */
function formatToolResultMessage(provider, toolCall, content) {
  if (provider === PROVIDER_OPENAI) {
    return {
      role: 'tool',
      tool_call_id: toolCall && toolCall.id ? toolCall.id : 'call_0',
      content: contentToText(content)
    };
  }
  return { role: 'tool', content: contentToText(content) };
}

/**
 * Probe the configured provider with a tiny non-streaming request to verify
 * connectivity and credentials. Returns a structured result for the UI.
 *
 * @param {{provider: string, baseUrl: string, apiKey?: string, model?: string}} cfg
 * @returns {Promise<{ok: boolean, message: string}>}
 */
function testConnection(cfg) {
  if (cfg.provider === PROVIDER_OPENAI) {
    return testOpenAI(cfg);
  }
  return testOllama(cfg);
}

function testOllama(cfg) {
  return new Promise((resolve) => {
    try {
      const url = new URL('/api/tags', cfg.baseUrl || OLLAMA_DEFAULT_URL);
      const req = pickHttpModule(url).request(
        buildRequestOptions(url, 'GET', {}),
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve({ ok: true, message: `Ollama reachable at ${url.origin}` });
            } else {
              resolve({ ok: false, message: `Ollama responded with HTTP ${res.statusCode}: ${body.slice(0, 200)}` });
            }
          });
        }
      );
      req.on('error', (err) => resolve({ ok: false, message: `Cannot reach Ollama: ${err.message}` }));
      req.end();
    } catch (err) {
      resolve({ ok: false, message: `Invalid configuration: ${err.message}` });
    }
  });
}

function testOpenAI(cfg) {
  return new Promise((resolve) => {
    try {
      if (!cfg.baseUrl) {
        resolve({ ok: false, message: 'Base URL is empty.' });
        return;
      }
      const trimmed = cfg.baseUrl.replace(/\/+$/, '');
      const url = new URL(trimmed + '/models');
      const headers = {};
      if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
      const req = pickHttpModule(url).request(
        buildRequestOptions(url, 'GET', headers),
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve({ ok: true, message: `OpenAI-compatible endpoint reachable at ${trimmed}` });
            } else {
              resolve({ ok: false, message: `Endpoint responded with HTTP ${res.statusCode}: ${body.slice(0, 200)}` });
            }
          });
        }
      );
      req.on('error', (err) => resolve({ ok: false, message: `Cannot reach endpoint: ${err.message}` }));
      req.end();
    } catch (err) {
      resolve({ ok: false, message: `Invalid configuration: ${err.message}` });
    }
  });
}

module.exports = {
  PROVIDER_OLLAMA,
  PROVIDER_OPENAI,
  getActiveProviderConfig,
  streamChat,
  formatToolResultMessage,
  formatOllamaApiError,
  testConnection
};

// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const aiProviders = require('../../services/aiProviders');
const modelInfo = require('../../services/modelInfo');
const {
  agentTools,
  TOOL_NAMES,
  executeAgentTool,
  normalizeToolArguments,
  truncateForModel,
  parseFallbackToolCalls,
  estimateTokens,
  trimHistoryToTokenBudget,
  applyEdit,
  collectPromptImages
} = require('../../services/agentTools');
const { buildWriteDiff } = require('../../services/diffPreview');

// Connection-level errors worth one automatic retry — but only before any
// content has streamed (a mid-stream retry would duplicate output).
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE']);

// Keep conversation history within this fraction of the model's context so
// the current prompt, system message, and tool results have room to breathe.
const HISTORY_BUDGET_FRACTION = 0.5;

const PERMISSION_DENIED_RESULT =
  'User denied permission for this command. Ask the user or try a different approach.';

const EDIT_REJECTED_RESULT = 'User rejected this edit';

// Vision models tokenize large images very expensively (a full-res screenshot
// can cost thousands of tokens). Downscale to this bound before attaching.
const IMAGE_MAX_DIMENSION = 1024;

// Downscale + JPEG-encode an image via Electron's nativeImage. Returns
// { data, mime } (JPEG) so OpenAI-compatible providers can build a correct
// data URI, or null on any failure so the caller falls back to raw bytes.
function encodePromptImage(filePath) {
  try {
    const { nativeImage } = require('electron');
    let img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    if (Math.max(width, height) > IMAGE_MAX_DIMENSION) {
      img = width >= height
        ? img.resize({ width: IMAGE_MAX_DIMENSION })
        : img.resize({ height: IMAGE_MAX_DIMENSION });
    }
    return { data: img.toJPEG(80).toString('base64'), mime: 'image/jpeg' };
  } catch (_) {
    return null;
  }
}

/**
 * Register agent IPC handlers.
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ state: import('../../services/sessionState').SessionState, bus: import('../rendererBus').RendererBus, configStore: typeof import('../../services/configStore'), terminalService: ReturnType<import('./terminal').createTerminalService>, permissionBroker: ReturnType<import('../../services/agentPermissions').createPermissionBroker>, gitService?: ReturnType<import('./git').createGitService> }} deps
 */
function registerHandlers(ipcMain, { state, bus, configStore, terminalService, permissionBroker, gitService }) {
  // Broadcast helper — sends to both the main window and the detached terminal
  // window so that streamed agent output shows up wherever the user is looking.
  const sendOutput = terminalService
    ? (channel, ...args) => terminalService.syncTerminalOutput(channel, ...args)
    : (channel, ...args) => bus.send(channel, ...args);

  // Context health stats IPC
  ipcMain.handle('get-context-stats', async () => {
    const model = configStore.getActiveModel();
    const history = state.agentConversationHistory;
    const estimatedTokens = estimateTokens(history);
    const contextLimit = await modelInfo.getEffectiveContextLimit(configStore);

    return {
      model: model || 'none',
      messageCount: history.length,
      estimatedTokens,
      contextLimit,
      usagePercent: Math.round((estimatedTokens / contextLimit) * 100)
    };
  });

  // Renderer answers to permission prompts land here (first response wins).
  ipcMain.handle('agent-permission-response', (event, payload) => {
    const { id, answer } = payload || {};
    return permissionBroker.resolveRequest(id, answer);
  });

  // Emit provider-not-ready errors; returns true when it's safe to proceed.
  function ensureProviderReady(cfg) {
    if (cfg.provider === aiProviders.PROVIDER_OLLAMA) {
      if (!state.availableAITools.ollama) {
        sendOutput('claude-error', 'Ollama is not installed. Install it from https://ollama.ai\n');
        sendOutput('claude-done', 1);
        return false;
      }
      if (state.availableAITools.ollamaModels.length === 0) {
        sendOutput('claude-error', 'No Ollama models found. Run: ollama pull llama3.2\n');
        sendOutput('claude-done', 1);
        return false;
      }
    }
    if (!cfg.model) {
      const hint = cfg.provider === 'openai-compatible'
        ? 'Configure it via AI menu → Configure OpenAI-Compatible Endpoint…'
        : 'Select one from the AI menu.';
      sendOutput('claude-error', `No AI model selected. ${hint}\n`);
      sendOutput('claude-done', 1);
      return false;
    }
    return true;
  }

  /**
   * Stream one chat completion. Tracks the in-flight request on session state
   * so claude-stop can destroy it, and retries once on pre-content connection
   * errors.
   * @param {object} cfg active provider config
   * @param {Array<object>} messages
   * @param {(channel: string, ...args: any[]) => void} contentOutput where streamed prose goes
   * @param {{tools?: Array<object>|null}} [opts] pass tools: null for a plain chat completion
   */
  async function streamChatWithRetry(cfg, messages, contentOutput, { tools = agentTools } = {}) {
    let contentStarted = false;
    const doStream = () => aiProviders.streamChat({
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      maxTokens: cfg.maxTokens,
      numCtx: cfg.numCtx,
      messages,
      tools,
      onContent: (chunk, isReasoning) => {
        contentStarted = true;
        contentOutput(isReasoning ? 'claude-thinking' : 'claude-output', chunk);
      },
      isAborted: () => state.agentAborted,
      onRequest: (req) => { state.agentActiveRequest = req; }
    });

    try {
      return await doStream();
    } catch (e) {
      const code = e && e.code;
      if (!contentStarted && !state.agentAborted && RETRYABLE_CODES.has(code)) {
        sendOutput('claude-status', '(connection error, retrying...)');
        return await doStream();
      }
      throw e;
    } finally {
      state.agentActiveRequest = null;
    }
  }

  /**
   * Compute a diff preview for a pending write_file/edit_file call. Returns
   * null when a diff can't or shouldn't be shown (missing file for edit_file,
   * failed dry-run match, unexpected errors) — the caller then falls back to
   * the plain permission prompt and the executor reports the real error.
   * @param {string} toolName
   * @param {object} toolArgs normalized arguments
   * @param {string} workingDir
   */
  async function computeWriteDiff(toolName, toolArgs, workingDir) {
    try {
      const rawPath = String(toolArgs.path || '');
      if (!rawPath) return null;
      const filePath = path.isAbsolute(rawPath) ? rawPath : path.join(workingDir, rawPath);
      const exists = fs.existsSync(filePath);
      const oldContent = exists ? fs.readFileSync(filePath, 'utf-8') : '';

      let newContent;
      if (toolName === 'write_file') {
        newContent = String(toolArgs.content || '');
      } else {
        if (!exists) return null;
        const result = applyEdit(
          oldContent,
          String(toolArgs.old_string != null ? toolArgs.old_string : ''),
          String(toolArgs.new_string != null ? toolArgs.new_string : ''),
          toolArgs.replace_all === true || toolArgs.replace_all === 'true'
        );
        if (!result.ok) return null;
        newContent = result.content;
      }

      // Repo-relative display path when cwd is inside a git repo (the
      // requested `git diff --stat`-style header), else workingDir-relative.
      let displayPath = filePath;
      const relToCwd = path.relative(workingDir, filePath);
      if (relToCwd && !relToCwd.startsWith('..')) displayPath = relToCwd.split(path.sep).join('/');
      if (gitService) {
        const info = await gitService.getRepoInfo(workingDir);
        if (info && info.isRepo) {
          const rel = path.relative(info.root, filePath);
          if (rel && !rel.startsWith('..')) displayPath = rel.split(path.sep).join('/');
        }
      }

      return buildWriteDiff(displayPath, oldContent, newContent);
    } catch (_) {
      return null;
    }
  }

  /**
   * Gate and execute a batch of tool calls, streaming announcements/results
   * to the terminal and appending tool-result messages for the model.
   * @param {Array<object>} toolCalls
   * @param {Array<object>} messages
   * @param {object} cfg
   * @param {string} workingDir
   * @param {{persistHistory: boolean}} opts persist flattened tool use to conversation history
   */
  async function processToolCalls(toolCalls, messages, cfg, workingDir, { persistHistory }) {
    for (const toolCall of toolCalls) {
      if (state.agentAborted) break;

      const toolName = toolCall.function.name;
      const toolArgs = normalizeToolArguments(toolCall.function.arguments);

      // Show tool call in terminal
      sendOutput('claude-output', `\n▶ ${toolName}: ${JSON.stringify(toolArgs)}\n`);

      // Diff-before-write: show the exact change instead of a bare prompt.
      let diffInfo = null;
      if ((toolName === 'write_file' || toolName === 'edit_file') && configStore.getAgentDiffGate()) {
        diffInfo = await computeWriteDiff(toolName, toolArgs, workingDir);
      }

      let toolResult;
      const verdict = await permissionBroker.gate(toolName, toolArgs, configStore, diffInfo ? { diff: diffInfo } : {});
      if (state.agentAborted) break;

      if (verdict !== 'allow') {
        toolResult = diffInfo ? EDIT_REJECTED_RESULT : PERMISSION_DENIED_RESULT;
        sendOutput('claude-output', diffInfo ? 'Edit rejected.\n' : 'Permission denied.\n');
      } else {
        toolResult = await executeAgentTool(toolName, toolArgs, workingDir, { configStore, state });

        // Show result (truncated if too long)
        const displayResult = toolResult.length > 2000
          ? toolResult.substring(0, 2000) + '\n... (truncated)'
          : toolResult;
        sendOutput('claude-output', `${displayResult}\n`);

        // Agent writes bypass the write-file IPC handler (agentTools hits fs
        // directly), so nudge the git UI from here.
        if (gitService && (toolName === 'write_file' || toolName === 'edit_file') && !toolResult.startsWith('Error')) {
          gitService.notifyExternalChange();
        }
      }

      // Tool result for the current loop, capped so one big read/cat can't
      // blow the context window. OpenAI-compatible providers require a
      // tool_call_id; aiProviders handles that.
      messages.push(aiProviders.formatToolResultMessage(cfg.provider, toolCall, truncateForModel(toolResult)));

      if (persistHistory) {
        // Save flattened tool call and result to conversation history
        state.agentConversationHistory.push({
          role: 'assistant',
          content: `[Used ${toolName}: ${JSON.stringify(toolArgs)}]\n\nResult:\n${toolResult.substring(0, 1000)}${toolResult.length > 1000 ? '...' : ''}`
        });
      }
    }
  }

  // Agent execution with streaming and tool calling, provider-agnostic.
  ipcMain.handle('agent-execute', async (event, prompt, cwd, opts) => {
    const cfg = aiProviders.getActiveProviderConfig(configStore);
    if (!ensureProviderReady(cfg)) return 1;

    state.agentAborted = false;
    const workingDir = cwd || process.env.HOME;
    // /chat mode: no tool schemas in the request and a much shorter system
    // prompt — thousands fewer tokens to prompt-eval, so the first token
    // arrives far sooner on slow local backends. Shares the same history.
    const noTools = !!(opts && opts.noTools);

    // Check for /clear command to reset conversation
    if (prompt.trim().toLowerCase() === 'clear' || prompt.trim().toLowerCase() === '/clear') {
      state.clearAgentConversationHistory();
      bus.send('context-stats-updated');
      bus.sendToTerminal('context-stats-updated');
      sendOutput('claude-output', 'Conversation history cleared.\n');
      sendOutput('claude-done', 0);
      return 0;
    }

    // Build messages array - include conversation history for context
    const today = new Date().toISOString().split('T')[0];
    const systemMessage = noTools ? {
      role: 'system',
      content: `You are a helpful assistant. Answer the user directly in GitHub-Flavored Markdown. Today's date is ${today}. You have access to conversation history, so you can answer follow-up questions about previous results.`
    } : {
      role: 'system',
      content: `You are a helpful assistant with access to tools. Use tools to help the user accomplish tasks. The current working directory is: ${workingDir}. Today's date is ${today}.

When you need to run commands, read files, write files, or list directories, use the appropriate tool.
Use edit_file for targeted changes to existing files instead of rewriting whole files with write_file. Use search_files to find where something lives in a project.
When the user asks about a PDF or provides a .pdf path, use read_pdf or read_file to extract the document text directly. Do not look for pdftotext, Python PDF libraries, or other external PDF utilities first.
When the user asks you to search the internet, look up current information, find recent news, or uses words like "zoek", "search", "latest", "recent", or "news", ALWAYS use the tavily_search tool — do not answer from memory. Use fetch_url to read a specific page when you already know its URL.
Some tool calls require the user's permission; if one is denied, do not retry it verbatim — adjust your approach or ask the user.
After using tools, provide a summary of what you did. You have access to conversation history, so you can answer follow-up questions about previous results.`
    };

    // Trim history to the model's context budget BEFORE building messages so
    // an over-budget history (e.g. after a model switch) can't blow the request.
    const contextLimit = await modelInfo.getEffectiveContextLimit(configStore);
    const historyBudget = Math.floor(contextLimit * HISTORY_BUDGET_FRACTION);
    if (cfg.provider === aiProviders.PROVIDER_OLLAMA) cfg.numCtx = contextLimit;

    // Cap the prompt itself: /doc embeds whole documents, which can dwarf
    // the window (a 286KB note is ~66k tokens). The current request wins
    // over old history — if a big prompt is squeezed, trim history harder.
    const RESPONSE_HEADROOM_TOKENS = 1024;
    const sysTokens = estimateTokens([systemMessage]);
    const promptTokens = estimateTokens([{ content: prompt }]);
    let promptForModel = prompt;
    let available = contextLimit - sysTokens - RESPONSE_HEADROOM_TOKENS - estimateTokens(state.agentConversationHistory);
    if (promptTokens > available) {
      const minPromptTokens = Math.floor(contextLimit * 0.25);
      if (available < minPromptTokens) {
        state.agentConversationHistory = trimHistoryToTokenBudget(
          state.agentConversationHistory,
          Math.max(0, contextLimit - sysTokens - RESPONSE_HEADROOM_TOKENS - minPromptTokens)
        );
        available = minPromptTokens;
      }
      if (promptTokens > available) {
        promptForModel = truncateForModel(prompt, available * 4);
        sendOutput('claude-status', `(prompt truncated to fit the ${contextLimit}-token context window — for whole-document questions try /rag, or raise it via AI menu → Set Ollama Context Size…)`);
      }
    }
    state.agentConversationHistory = trimHistoryToTokenBudget(state.agentConversationHistory, historyBudget);

    // Vision: if the prompt (or embedded document) references images, attach
    // them to the outgoing user message so multimodal models can see them.
    // Ollama takes raw base64 in a top-level `images` array; OpenAI-compatible
    // providers take `image_url` content parts built from `images`+`imageMimes`
    // (see toOpenAIMessage). Only the request copy carries the pixels — history
    // stays text-only. Images are collected from the ORIGINAL prompt so
    // truncation can't cut away the references; the message text is the capped
    // version.
    let userMessage = { role: 'user', content: promptForModel };
    if (cfg.provider === aiProviders.PROVIDER_OLLAMA || cfg.provider === aiProviders.PROVIDER_OPENAI) {
      const baseDirs = [
        state.currentFilePath ? path.dirname(state.currentFilePath) : null,
        workingDir
      ];
      const { images, names, mimes } = collectPromptImages(prompt, baseDirs, { encoder: encodePromptImage });
      if (images.length > 0) {
        userMessage = cfg.provider === aiProviders.PROVIDER_OLLAMA
          ? { role: 'user', content: promptForModel, images }
          : { role: 'user', content: promptForModel, images, imageMimes: mimes };
        sendOutput('claude-status', `(attached ${images.length} image${images.length === 1 ? '' : 's'}: ${names.join(', ')})`);
      }
    }

    // Start with system message, then history, then new prompt
    const messages = [systemMessage, ...state.agentConversationHistory, userMessage];

    // Add user message to history (capped text only — never the base64 payload)
    state.agentConversationHistory.push({ role: 'user', content: promptForModel });

    try {
      let iterations = 0;
      const maxIterations = 20; // Prevent infinite loops
      let lastMetrics = null;

      while (iterations < maxIterations && !state.agentAborted) {
        iterations++;

        // Stream a chat completion from whichever provider is active.
        const assistantMessage = await streamChatWithRetry(cfg, messages, sendOutput, { tools: noTools ? null : agentTools });

        if (!assistantMessage) {
          throw new Error('No response from model');
        }
        if (assistantMessage.metrics) lastMetrics = assistantMessage.metrics;

        // Add assistant message to messages for multi-turn tool loop
        messages.push(assistantMessage);

        // Native tool calls, falling back to JSON-in-text for models without
        // native tool calling. In /chat mode no tools were offered, so any
        // JSON in the reply is just content — never execute it.
        let toolCalls = noTools ? [] : (assistantMessage.tool_calls || []);
        if (!noTools && toolCalls.length === 0 && assistantMessage.content) {
          toolCalls = parseFallbackToolCalls(assistantMessage.content, TOOL_NAMES);
        }

        if (toolCalls.length > 0) {
          await processToolCalls(toolCalls, messages, cfg, workingDir, { persistHistory: true });
        } else {
          // No tool calls - model is done, save final response to history
          if (assistantMessage.content) {
            state.agentConversationHistory.push({
              role: 'assistant',
              content: assistantMessage.content
            });
          }
          break;
        }
      }

      if (iterations >= maxIterations) {
        sendOutput('claude-output', '\n(Reached maximum iterations)\n');
      }

      // Keep history within the token budget for the next turn.
      state.agentConversationHistory = trimHistoryToTokenBudget(state.agentConversationHistory, historyBudget);

      // Notify renderer to update context stats
      bus.send('context-stats-updated');
      bus.sendToTerminal('context-stats-updated');
      if (lastMetrics) sendOutput('claude-metrics', lastMetrics);
      sendOutput('claude-done', 0);
      return 0;
    } catch (e) {
      if (state.agentAborted) {
        // Stop destroyed the request — that's not an error worth reporting.
        sendOutput('claude-done', -1);
        return -1;
      }
      sendOutput('claude-error', `Agent error: ${e.message}\n`);
      sendOutput('claude-done', 1);
      return 1;
    }
  });

  // Agent execution that researches the web (and other tools) and returns the
  // final document content for /write-new. Tool activity streams to the terminal
  // via 'claude-output'; the resolved value is the clean document body to insert
  // into the editor. Does NOT touch agent conversation history (one-shot).
  ipcMain.handle('agent-execute-editor', async (event, prompt, cwd) => {
    const cfg = aiProviders.getActiveProviderConfig(configStore);
    if (!ensureProviderReady(cfg)) return '';

    state.agentAborted = false;
    const workingDir = cwd || process.env.HOME;
    const today = new Date().toISOString().split('T')[0];
    const editorContextLimit = await modelInfo.getEffectiveContextLimit(configStore);
    if (cfg.provider === aiProviders.PROVIDER_OLLAMA) {
      cfg.numCtx = editorContextLimit;
    }

    const systemMessage = {
      role: 'system',
      content: `You are a research-and-writing assistant with web access. The current working directory is: ${workingDir}. Today's date is ${today}.

ALWAYS use the tavily_search tool to gather the latest, most accurate information BEFORE writing — do not rely on memory, as it may be outdated. Use fetch_url to read a promising source in full.

After researching, output ONLY the final document body in GitHub-Flavored Markdown. Do NOT include a preamble, a description of your steps, or a summary of what you did. Do NOT wrap the document in code fences. Do NOT add YAML frontmatter (the editor adds it). Use tables, headings, and lists where they improve clarity.`
    };

    // Cap oversized prompts (e.g. /write-append embeds the current document).
    const editorPromptBudget = editorContextLimit - estimateTokens([systemMessage]) - 1024;
    let editorPrompt = prompt;
    if (estimateTokens([{ content: prompt }]) > editorPromptBudget) {
      editorPrompt = truncateForModel(prompt, editorPromptBudget * 4);
      sendOutput('claude-status', `(prompt truncated to fit the ${editorContextLimit}-token context window)`);
    }

    const messages = [systemMessage, { role: 'user', content: editorPrompt }];

    // Suppress the model's streamed prose from the terminal — it lands in the
    // editor instead. Tool announcements/results (sent via sendOutput inside
    // processToolCalls) stay visible so the user can watch the research happen.
    const quietOutput = (channel, ...args) => {
      if (channel === 'claude-output') return;
      sendOutput(channel, ...args);
    };

    try {
      let iterations = 0;
      const maxIterations = 20;
      let finalContent = '';
      let lastMetrics = null;

      while (iterations < maxIterations && !state.agentAborted) {
        iterations++;

        const assistantMessage = await streamChatWithRetry(cfg, messages, quietOutput);

        if (!assistantMessage) {
          throw new Error('No response from model');
        }
        if (assistantMessage.metrics) lastMetrics = assistantMessage.metrics;

        messages.push(assistantMessage);

        let toolCalls = assistantMessage.tool_calls || [];
        if (toolCalls.length === 0 && assistantMessage.content) {
          toolCalls = parseFallbackToolCalls(assistantMessage.content, TOOL_NAMES);
        }

        if (toolCalls.length > 0) {
          await processToolCalls(toolCalls, messages, cfg, workingDir, { persistHistory: false });
        } else {
          // No tool calls — this is the final document.
          finalContent = assistantMessage.content || '';
          break;
        }
      }

      if (iterations >= maxIterations) {
        sendOutput('claude-output', '\n(Reached maximum iterations)\n');
      }

      bus.send('context-stats-updated');
      bus.sendToTerminal('context-stats-updated');
      if (lastMetrics) sendOutput('claude-metrics', lastMetrics);
      sendOutput('claude-done', 0);
      return finalContent;
    } catch (e) {
      if (state.agentAborted) {
        sendOutput('claude-done', -1);
        return '';
      }
      sendOutput('claude-error', `Agent error: ${e.message}\n`);
      sendOutput('claude-done', 1);
      return '';
    }
  });

  // Clear agent conversation history
  ipcMain.handle('agent-clear-history', () => {
    state.clearAgentConversationHistory();
    bus.send('context-stats-updated');
    bus.sendToTerminal('context-stats-updated');
  });
}

module.exports = { registerHandlers };

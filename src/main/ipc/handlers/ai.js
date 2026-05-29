// @ts-check
'use strict';

const fs = require('fs');
const { execSync } = require('child_process');
const aiProviders = require('../../services/aiProviders');

// Find executable path
function findExecutable(name) {
  // Check common locations directly (packaged apps have limited PATH)
  const commonPaths = [
    `/opt/homebrew/bin/${name}`,  // Apple Silicon homebrew
    `/usr/local/bin/${name}`,      // Intel homebrew / Linux
    `/usr/bin/${name}`,            // System
    `${process.env.HOME}/.local/bin/${name}` // User local
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Fallback to which
  try {
    const result = execSync(`which ${name}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0];
    return result || null;
  } catch (e) {
    return null;
  }
}

// Get list of installed Ollama models
function getOllamaModels(ollamaPath) {
  if (!ollamaPath) return [];
  try {
    const result = execSync(`"${ollamaPath}" list`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
    const lines = result.trim().split('\n');
    // Skip header line, parse model names
    const models = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(/\s+/);
      if (parts[0]) {
        models.push(parts[0]); // Model name is first column
      }
    }
    return models;
  } catch (e) {
    return [];
  }
}

// Detect available Ollama installation and models
function detectAITools(state) {
  state.availableAITools.ollama = findExecutable('ollama');
  state.availableAITools.ollamaModels = getOllamaModels(state.availableAITools.ollama);

  return state.availableAITools;
}

/**
 * Register AI IPC handlers.
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ state: import('../../services/sessionState').SessionState, bus: import('../rendererBus').RendererBus, configStore: typeof import('../../services/configStore'), terminalService: ReturnType<import('./terminal').createTerminalService> }} deps
 */
function registerHandlers(ipcMain, { state, bus, configStore, terminalService }) {
  // Chat execution — provider-agnostic. The IPC channel name is kept as
  // `claude-execute` for backward compatibility with the renderer.
  ipcMain.handle('claude-execute', async (event, command, cwd) => {
    const cfg = aiProviders.getActiveProviderConfig(configStore);

    // Abort any existing request
    if (state.ollamaAbortController) {
      state.ollamaAbortController.abort();
      state.ollamaAbortController = null;
    }

    // Ollama provider also requires the binary so we can detect models, etc.
    if (cfg.provider === 'ollama') {
      const execPath = state.availableAITools.ollama;
      if (!execPath) {
        terminalService.syncTerminalOutput('claude-error', 'Ollama is not installed. Install it from https://ollama.ai\n');
        terminalService.syncTerminalOutput('claude-done', 1);
        return 1;
      }
      if (state.availableAITools.ollamaModels.length === 0) {
        terminalService.syncTerminalOutput('claude-error', `No Ollama models found. Run: ollama pull llama3.2\n`);
        terminalService.syncTerminalOutput('claude-done', 1);
        return 1;
      }
    }

    if (!cfg.model) {
      const hint = cfg.provider === 'openai-compatible'
        ? 'Configure it via AI menu → Configure OpenAI-Compatible Endpoint…'
        : 'Select one from the AI menu.';
      terminalService.syncTerminalOutput('claude-error', `No AI model selected. ${hint}\n`);
      terminalService.syncTerminalOutput('claude-done', 1);
      return 1;
    }

    // Add user message to history
    state.chatHistory.push({ role: 'user', content: command });

    let aborted = false;
    let activeReq = null;

    state.ollamaAbortController = {
      abort: () => {
        aborted = true;
        if (activeReq) activeReq.destroy();
        if (state.chatHistory.length > 0 && state.chatHistory[state.chatHistory.length - 1].role === 'user') {
          state.chatHistory.pop();
        }
      }
    };

    try {
      const assistant = await aiProviders.streamChat({
        provider: cfg.provider,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        messages: state.chatHistory,
        onContent: (chunk) => {
          if (!aborted) terminalService.syncTerminalOutput('claude-output', chunk);
        },
        isAborted: () => aborted,
        onRequest: (req) => { activeReq = req; }
      });

      if (!aborted && assistant.content) {
        state.chatHistory.push({ role: 'assistant', content: assistant.content });
      }
      terminalService.syncTerminalOutput('claude-done', 0);
      return 0;
    } catch (err) {
      if (!aborted) {
        state.chatHistory.pop(); // remove the user message that didn't get a response
        terminalService.syncTerminalOutput('claude-error', `${err.message}\n`);
        terminalService.syncTerminalOutput('claude-done', 1);
      }
      return 1;
    }
  });

  ipcMain.on('claude-stop', () => {
    if (state.ollamaAbortController) {
      state.ollamaAbortController.abort();
      state.ollamaAbortController = null;
      terminalService.syncTerminalOutput('claude-done', -1);
    }
    // Also stop agent mode
    state.agentAborted = true;
  });

  // Clear conversation history
  ipcMain.on('claude-clear-history', () => {
    state.clearChatHistory();
  });

  ipcMain.handle('get-ai-provider', () => {
    return {
      provider: configStore.getAIProvider(),
      model: configStore.getActiveModel()
    };
  });

  // Full provider configuration (used by the AI menu and connection test).
  ipcMain.handle('get-ai-provider-config', () => {
    return {
      provider: configStore.getAIProvider(),
      ollamaModel: configStore.getOllamaModel(),
      openaiBaseUrl: configStore.getOpenAIBaseUrl(),
      openaiApiKey: configStore.getOpenAIApiKey(),
      openaiModel: configStore.getOpenAIModel(),
      openaiEndpoints: configStore.getOpenAIEndpoints(),
      activeOpenaiEndpointIndex: configStore.getActiveOpenAIEndpointIndex()
    };
  });

  ipcMain.handle('set-ai-provider-config', (event, cfg) => {
    if (cfg && typeof cfg.provider === 'string') configStore.setAIProvider(cfg.provider);
    if (cfg && typeof cfg.openaiBaseUrl === 'string') configStore.setOpenAIBaseUrl(cfg.openaiBaseUrl);
    if (cfg && typeof cfg.openaiApiKey === 'string') configStore.setOpenAIApiKey(cfg.openaiApiKey);
    if (cfg && typeof cfg.openaiModel === 'string') configStore.setOpenAIModel(cfg.openaiModel);

    const next = {
      provider: configStore.getAIProvider(),
      model: configStore.getActiveModel()
    };
    bus.send('ai-provider-changed', next);
    bus.sendToTerminal('ai-provider-changed', next);
    return next;
  });

  // Quick non-streaming probe for the active provider.
  ipcMain.handle('test-ai-connection', async () => {
    const cfg = aiProviders.getActiveProviderConfig(configStore);
    return aiProviders.testConnection(cfg);
  });
}

module.exports = { findExecutable, getOllamaModels, detectAITools, registerHandlers };

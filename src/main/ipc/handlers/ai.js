// @ts-check
'use strict';

const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');

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
  // Ollama execution using HTTP API with conversation history
  ipcMain.handle('claude-execute', async (event, command, cwd) => {
    const ollamaModel = configStore.getOllamaModel();

    // Abort any existing request
    if (state.ollamaAbortController) {
      state.ollamaAbortController.abort();
      state.ollamaAbortController = null;
    }

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
    if (!ollamaModel) {
      terminalService.syncTerminalOutput('claude-error', 'No AI model selected. Select one from the AI menu.\n');
      terminalService.syncTerminalOutput('claude-done', 1);
      return 1;
    }

    // Add user message to history
    state.chatHistory.push({ role: 'user', content: command });

    // Build request with full conversation history
    const requestBody = JSON.stringify({
      model: ollamaModel,
      messages: state.chatHistory,
      stream: true
    });

    return new Promise((resolve) => {
      let assistantResponse = '';
      let aborted = false;

      const req = http.request({
        hostname: '127.0.0.1',
        port: 11434,
        path: '/api/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      }, (res) => {
        res.setEncoding('utf8');
        let buffer = '';

        res.on('data', (chunk) => {
          if (aborted) return;

          buffer += chunk;
          // Process complete JSON lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (json.message && json.message.content) {
                const content = json.message.content;
                assistantResponse += content;
                terminalService.syncTerminalOutput('claude-output', content);
              }
              if (json.done) {
                // Save assistant response to history
                if (assistantResponse) {
                  state.chatHistory.push({ role: 'assistant', content: assistantResponse });
                }
                terminalService.syncTerminalOutput('claude-done', 0);
                resolve(0);
              }
            } catch (e) {
              // Ignore parse errors for incomplete lines
            }
          }
        });

        res.on('end', () => {
          if (!aborted) {
            // Process any remaining buffer
            if (buffer.trim()) {
              try {
                const json = JSON.parse(buffer);
                if (json.message && json.message.content) {
                  assistantResponse += json.message.content;
                  terminalService.syncTerminalOutput('claude-output', json.message.content);
                }
              } catch (e) {
                // Ignore
              }
            }
            // Save assistant response if not already done
            if (assistantResponse && !state.chatHistory.some(m => m.role === 'assistant' && m.content === assistantResponse)) {
              state.chatHistory.push({ role: 'assistant', content: assistantResponse });
            }
            terminalService.syncTerminalOutput('claude-done', 0);
            resolve(0);
          }
        });
      });

      req.on('error', (err) => {
        if (!aborted) {
          // Remove the user message if request failed
          state.chatHistory.pop();
          terminalService.syncTerminalOutput('claude-error', `Connection error: ${err.message}\nMake sure Ollama is running: ollama serve\n`);
          terminalService.syncTerminalOutput('claude-done', 1);
          resolve(1);
        }
      });

      // Store abort function
      state.ollamaAbortController = {
        abort: () => {
          aborted = true;
          req.destroy();
          // Remove the user message if aborted
          if (state.chatHistory.length > 0 && state.chatHistory[state.chatHistory.length - 1].role === 'user') {
            state.chatHistory.pop();
          }
        }
      };

      req.write(requestBody);
      req.end();
    });
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
      model: configStore.getOllamaModel()
    };
  });
}

module.exports = { findExecutable, getOllamaModels, detectAITools, registerHandlers };

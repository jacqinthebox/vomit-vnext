// @ts-check
'use strict';

const pty = require('node-pty');
const fs = require('fs');
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
 * @param {{ state: import('../../services/sessionState').SessionState, bus: import('../rendererBus').RendererBus, configStore: typeof import('../../services/configStore') }} deps
 */
function registerHandlers(ipcMain, { state, bus, configStore }) {
  // Ollama execution using node-pty for proper TTY support
  ipcMain.handle('claude-execute', async (event, command, cwd) => {
    const ollamaModel = configStore.getOllamaModel();

    return new Promise((resolve, reject) => {
      // Kill any existing process
      if (state.ollamaProcess) {
        state.ollamaProcess.kill();
        state.ollamaProcess = null;
      }

      const execPath = state.availableAITools.ollama;
      if (!execPath) {
        bus.send('claude-error', 'Ollama is not installed. Install it from https://ollama.ai\n');
        bus.send('claude-done', 1);
        resolve(1);
        return;
      }
      if (state.availableAITools.ollamaModels.length === 0) {
        bus.send('claude-error', `No Ollama models found. Run: ollama pull llama3.2\n`);
        bus.send('claude-done', 1);
        resolve(1);
        return;
      }
      if (!ollamaModel) {
        bus.send('claude-error', 'No AI model selected. Select one from the AI menu.\n');
        bus.send('claude-done', 1);
        resolve(1);
        return;
      }

      const args = ['run', ollamaModel, command];

      // Spawn Ollama with PTY for proper terminal emulation
      state.ollamaProcess = pty.spawn(execPath, args, {
        name: 'xterm-color',
        cols: 120,
        rows: 30,
        cwd: cwd,
        env: { ...process.env }
      });

      state.ollamaProcess.onData((data) => {
          // Clean ANSI escape codes and spinner characters but preserve newlines and spaces
          let cleanData = data
            .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')   // ANSI escape codes (colors, cursor, etc.)
            .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '') // Extended ANSI codes (DEC private modes)
            .replace(/\x1b\][^\x07]*\x07/g, '')      // OSC sequences (title, etc.)
            .replace(/\x1b\][^\x1b]*\x1b\\/g, '')    // OSC sequences with ST terminator
            .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')// DCS, SOS, PM, APC sequences
            .replace(/\x1b[NOcZ78=>]/g, '')          // Single-character escape sequences
            .replace(/\x1b\([A-Z0-9]/g, '')          // Character set selection
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Control characters (except \t\n\r)
            .replace(/[\u2800-\u28FF]/g, '')         // Braille spinner characters
            .replace(/\[K/g, '')                     // Erase line (orphaned)
            .replace(/\[1G/g, '')                    // Move cursor (orphaned)
            .replace(/\[2K/g, '')                    // Clear line (orphaned)
            .replace(/\r\n/g, '\n')                  // Normalize line endings
            .replace(/\r/g, '');                     // Remove remaining carriage returns

          // Send if there's any content (including just newlines for formatting)
          if (cleanData.length > 0) {
            bus.send('claude-output', cleanData);
          }
      });

      state.ollamaProcess.onExit(({ exitCode }) => {
        state.ollamaProcess = null;
        bus.send('claude-done', exitCode);
        resolve(exitCode);
      });
    });
  });

  ipcMain.on('claude-stop', () => {
    if (state.ollamaProcess) {
      state.ollamaProcess.kill(); // node-pty kill() method
      state.ollamaProcess = null;
      bus.send('claude-done', -1);
    }
    // Also stop agent mode
    state.agentAborted = true;
  });

  ipcMain.handle('get-ai-provider', () => {
    return {
      provider: configStore.getAIProvider(),
      model: configStore.getOllamaModel()
    };
  });
}

module.exports = { findExecutable, getOllamaModels, detectAITools, registerHandlers };

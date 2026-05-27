// @ts-check
'use strict';

const path = require('path');

/**
 * Create terminal service with terminal window functions and IPC handlers.
 * @param {{ state: import('../../services/sessionState').SessionState, bus: import('../rendererBus').RendererBus, windowManager: ReturnType<import('../../services/windowManager').createWindowManager> }} deps
 */
function createTerminalService({ state, bus, windowManager }) {

  function detachTerminal(payload) {
    if (!bus.getTerminalWindow()) {
      windowManager.createTerminalWindow();
    }

    // payload may be a string (legacy) or an object with full context from the
    // renderer. The renderer is the source of truth for projectRoot,
    // currentDirectory and currentFilePath because they don't exist on main's
    // SessionState.
    const data = typeof payload === 'string'
      ? { terminalHTML: payload }
      : (payload || {});

    const currentFilePath = data.currentFilePath || state.currentFilePath || null;
    const basePath = data.basePath || (currentFilePath ? path.dirname(currentFilePath) : null);

    const terminalData = {
      terminalHTML: data.terminalHTML || '',
      basePath,
      projectRoot: data.projectRoot || null,
      currentDirectory: data.currentDirectory || null,
      currentFilePath,
      currentTheme: state.currentTheme
    };

    const sendToTerminalWindow = () => {
      bus.sendToTerminal('load-terminal', terminalData);
    };

    // Use a small delay to ensure the renderer is fully initialized
    if (bus.getTerminalWindow().webContents.isLoading()) {
      bus.getTerminalWindow().webContents.once('did-finish-load', () => {
        setTimeout(sendToTerminalWindow, 100);
      });
    } else {
      setTimeout(sendToTerminalWindow, 100);
    }

    state.isTerminalDetached = true;
    bus.send('terminal-detached');
    bus.getTerminalWindow().focus();
  }

  /**
   * Forward updated file/project context from the main window renderer to the
   * detached terminal so it tracks tab switches, file opens and bucket changes.
   * @param {{currentFilePath?: string|null, projectRoot?: string|null, currentDirectory?: string|null, basePath?: string|null}} ctx
   */
  function syncTerminalContext(ctx) {
    if (!bus.getTerminalWindow()) return;
    const currentFilePath = ctx?.currentFilePath ?? null;
    const basePath = ctx?.basePath
      ?? (currentFilePath ? path.dirname(currentFilePath) : null);
    bus.sendToTerminal('terminal-context-update', {
      currentFilePath,
      basePath,
      projectRoot: ctx?.projectRoot ?? null,
      currentDirectory: ctx?.currentDirectory ?? null
    });
  }

  function reattachTerminal() {
    if (bus.getTerminalWindow()) {
      bus.getTerminalWindow().close();
    }
    state.isTerminalDetached = false;
    bus.send('terminal-reattached');
  }

  function focusTerminalWindow() {
    if (bus.getTerminalWindow()) {
      bus.getTerminalWindow().focus();
    }
  }

  /**
   * Broadcast terminal output to both main and terminal windows
   * @param {string} channel
   * @param  {...any} args
   */
  function syncTerminalOutput(channel, ...args) {
    bus.send(channel, ...args);
    bus.sendToTerminal(channel, ...args);
  }

  /**
   * Sync terminal tab change to detached window
   * @param {string} tab
   */
  function syncTerminalTab(tab) {
    bus.sendToTerminal('terminal-tab-changed', tab);
  }

  /**
   * Sync terminal input from detached window to main window
   * @param {string} input
   */
  function syncTerminalInput(input) {
    bus.send('terminal-input-synced', input);
  }

  /**
   * Sync terminal clear from detached window to main window
   */
  function syncTerminalClear() {
    bus.send('terminal-cleared');
  }

  /**
   * Get editor content from main window for detached terminal
   * @returns {{content: string, filePath: string|null}}
   */
  function getEditorContent() {
    return {
      content: state.currentContent || '',
      filePath: state.currentFilePath
    };
  }

  /**
   * Register terminal-related IPC handlers.
   * @param {import('electron').IpcMain} ipcMain
   */
  function registerHandlers(ipcMain) {
    ipcMain.on('detach-terminal', (event, payload) => {
      detachTerminal(payload);
    });

    ipcMain.on('reattach-terminal', () => {
      reattachTerminal();
    });

    ipcMain.on('focus-terminal-window', () => {
      focusTerminalWindow();
    });

    ipcMain.on('sync-terminal-tab', (event, tab) => {
      syncTerminalTab(tab);
    });

    ipcMain.on('sync-terminal-input', (event, input) => {
      syncTerminalInput(input);
    });

    ipcMain.on('sync-terminal-clear', () => {
      syncTerminalClear();
    });

    ipcMain.on('sync-terminal-context', (event, ctx) => {
      syncTerminalContext(ctx);
    });

    // The detached terminal can't manipulate the CodeMirror editor directly.
    // For editor-mutating commands (/write, /presentation, /pseudo, …) it
    // forwards the raw command back to the main window's TerminalManager,
    // which runs it normally. AI output already broadcasts to both windows
    // via syncTerminalOutput, so the detached terminal still shows the stream.
    ipcMain.on('execute-in-main-terminal', (event, command) => {
      bus.send('execute-detached-command', command);
    });

    ipcMain.handle('get-editor-content', () => {
      return getEditorContent();
    });
  }

  return {
    detachTerminal,
    reattachTerminal,
    focusTerminalWindow,
    syncTerminalOutput,
    syncTerminalTab,
    syncTerminalContext,
    registerHandlers
  };
}

module.exports = { createTerminalService };

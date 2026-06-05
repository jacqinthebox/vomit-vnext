// @ts-check
'use strict';

const pty = require('node-pty');
const os = require('os');

function getDefaultShell() {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

function getDefaultShellArgs(shell) {
  const basename = shell.toLowerCase().split(/[\\/]/).pop();
  if (process.platform === 'win32' && (basename === 'powershell.exe' || basename === 'pwsh.exe')) {
    return ['-NoLogo'];
  }
  return [];
}

/**
 * Register shell terminal IPC handlers.
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ state: import('../../services/sessionState').SessionState, bus: import('../../ipc/rendererBus').RendererBus, terminalService: ReturnType<import('./terminal').createTerminalService> }} deps
 */
function registerHandlers(ipcMain, { state, bus, terminalService }) {
  ipcMain.handle('shell-spawn', async (event, cwd) => {
    // Kill any existing shell process
    if (state.shellProcess) {
      state.shellProcess.kill();
      state.shellProcess = null;
    }

    const shell = getDefaultShell();
    const workingDir = cwd || os.homedir();

    state.shellProcess = pty.spawn(shell, getDefaultShellArgs(shell), {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: workingDir,
      env: { ...process.env, TERM: 'xterm-256color' }
    });

    state.shellProcess.onData((data) => {
      terminalService.syncTerminalOutput('shell-output', data);
    });

    state.shellProcess.onExit(({ exitCode }) => {
      state.shellProcess = null;
      terminalService.syncTerminalOutput('shell-exit', exitCode);
    });

    return 0;
  });

  ipcMain.on('shell-write', (event, data) => {
    if (state.shellProcess) {
      state.shellProcess.write(data);
    }
  });

  ipcMain.on('shell-stop', () => {
    if (state.shellProcess) {
      state.shellProcess.kill();
      state.shellProcess = null;
      terminalService.syncTerminalOutput('shell-exit', -1);
    }
  });

  ipcMain.on('shell-resize', (event, cols, rows) => {
    if (state.shellProcess && cols && rows) {
      state.shellProcess.resize(cols, rows);
    }
  });
}

module.exports = { registerHandlers };

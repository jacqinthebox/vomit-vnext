// @ts-check
'use strict';

// Pi terminal — spawns the Pi coding-agent harness (pi.dev) in its own PTY,
// alongside (not sharing) the plain shell PTY. Kept as a dedicated handler so
// the working shell code stays untouched and this stays cleanly removable.

const pty = require('node-pty');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Locate the `pi` executable. Pi ships via `npm i -g @earendil-works/pi-coding-agent`,
// so it lands in an npm global bin — NOT the homebrew/Ollama locations. Packaged
// Electron apps get a restricted PATH, so check the likely npm-global spots
// directly before falling back to which/where.
function resolvePiPath() {
  const isWin = process.platform === 'win32';
  const home = process.env.HOME || os.homedir() || '';
  const candidates = [];

  if (isWin) {
    const appData = process.env.APPDATA || '';
    candidates.push(
      path.join(appData, 'npm', 'pi.cmd'),
      path.join(appData, 'npm', 'pi.exe'),
      path.join(appData, 'npm', 'pi')
    );
  } else {
    candidates.push(
      '/usr/local/bin/pi',              // Intel homebrew / Linux npm prefix
      '/opt/homebrew/bin/pi',           // Apple Silicon homebrew npm prefix
      '/usr/bin/pi',                    // System
      path.join(home, '.npm-global', 'bin', 'pi'),
      path.join(home, '.local', 'bin', 'pi'),
      path.join(home, 'node_modules', '.bin', 'pi')
    );
    // nvm installs live under ~/.nvm/versions/node/<version>/bin — scan them so
    // an nvm-managed global pi resolves even with a stripped PATH.
    try {
      const nvmNode = path.join(home, '.nvm', 'versions', 'node');
      for (const ver of fs.readdirSync(nvmNode)) {
        candidates.push(path.join(nvmNode, ver, 'bin', 'pi'));
      }
    } catch { /* no nvm — ignore */ }
  }

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }

  // Fallback: platform lookup. Works in dev (`npm start`) where PATH is inherited.
  try {
    const lookup = isWin ? 'where.exe' : 'which';
    const result = execFileSync(lookup, ['pi'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim().split(/\r?\n/)[0];
    return result && fs.existsSync(result) ? result : null;
  } catch {
    return null;
  }
}

/**
 * Register pi terminal IPC handlers.
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ state: import('../../services/sessionState').SessionState, bus: import('../rendererBus').RendererBus, terminalService: any }} deps
 */
function registerHandlers(ipcMain, { state, bus, terminalService }) {
  // Detection — the renderer calls this before spawning so it can show an
  // install hint instead of a failed spawn when pi isn't on the machine.
  ipcMain.handle('pi-check', async () => {
    const piPath = resolvePiPath();
    return { available: !!piPath, path: piPath };
  });

  ipcMain.handle('pi-spawn', async (event, cwd) => {
    const piPath = resolvePiPath();
    if (!piPath) return { ok: false, reason: 'not-found' };

    // Kill any existing pi process before starting a fresh session.
    if (state.piProcess) {
      state.piProcess.kill();
      state.piProcess = null;
    }

    const workingDir = cwd || os.homedir();

    // Pi installs as an npm shim. On Windows that shim is `pi.cmd`, a batch
    // file — CreateProcess (what node-pty uses) can't execute .cmd/.bat
    // directly, so run it through the command interpreter. A real .exe (or any
    // POSIX binary) is spawned directly.
    let file = piPath;
    let spawnArgs = [];
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(piPath)) {
      file = process.env.COMSPEC || 'cmd.exe';
      spawnArgs = ['/c', piPath];
    }

    state.piProcess = pty.spawn(file, spawnArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: workingDir,
      env: { ...process.env, TERM: 'xterm-256color' }
    });

    state.piProcess.onData((data) => {
      terminalService.syncTerminalOutput('pi-output', data);
    });

    state.piProcess.onExit(({ exitCode }) => {
      state.piProcess = null;
      terminalService.syncTerminalOutput('pi-exit', exitCode);
    });

    return { ok: true };
  });

  ipcMain.on('pi-write', (event, data) => {
    if (state.piProcess) {
      state.piProcess.write(data);
    }
  });

  ipcMain.on('pi-stop', () => {
    if (state.piProcess) {
      state.piProcess.kill();
      state.piProcess = null;
      terminalService.syncTerminalOutput('pi-exit', -1);
    }
  });

  ipcMain.on('pi-resize', (event, cols, rows) => {
    if (state.piProcess && cols && rows) {
      state.piProcess.resize(cols, rows);
    }
  });
}

module.exports = { registerHandlers, resolvePiPath };

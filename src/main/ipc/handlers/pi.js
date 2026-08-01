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
      path.join(appData, 'npm', 'pi'),
    );
  } else {
    candidates.push(
      '/usr/local/bin/pi', // Intel homebrew / Linux npm prefix
      '/opt/homebrew/bin/pi', // Apple Silicon homebrew npm prefix
      '/usr/bin/pi', // System
      path.join(home, '.npm-global', 'bin', 'pi'),
      path.join(home, '.local', 'bin', 'pi'),
      path.join(home, 'node_modules', '.bin', 'pi'),
    );
    // nvm installs live under ~/.nvm/versions/node/<version>/bin — scan them so
    // an nvm-managed global pi resolves even with a stripped PATH.
    try {
      const nvmNode = path.join(home, '.nvm', 'versions', 'node');
      for (const ver of fs.readdirSync(nvmNode)) {
        candidates.push(path.join(nvmNode, ver, 'bin', 'pi'));
      }
    } catch {
      /* no nvm — ignore */
    }
  }

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }

  // Fallback: platform lookup. Works in dev (`npm start`) where PATH is inherited.
  try {
    const lookup = isWin ? 'where.exe' : 'which';
    const result = execFileSync(lookup, ['pi'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .trim()
      .split(/\r?\n/)[0];
    return result && fs.existsSync(result) ? result : null;
  } catch {
    return null;
  }
}

// --- Vomit awareness -------------------------------------------------------
// Pi learns which doc/folder is open in Vomit through two pieces:
//   1. A context file (~/.config/vomit/pi-context.json) that the renderer
//      refreshes on every tab switch, file open and bucket change.
//   2. A pi extension (~/.pi/agent/extensions/vomit-context.ts, installed on
//      spawn) that reads the context file on each prompt and injects the
//      current doc/folder into the conversation. Reading per-prompt is what
//      makes the context live — no respawn needed when the user switches tabs.

const CONTEXT_FILE = path.join(os.homedir(), '.config', 'vomit', 'pi-context.json');
const EXTENSION_FILE = path.join(os.homedir(), '.pi', 'agent', 'extensions', 'vomit-context.ts');

const EXTENSION_SOURCE = `// Installed by Vomit (${'do not edit — overwritten on every Pi start in Vomit'}).
// Injects the doc/folder currently open in the Vomit editor into each prompt.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONTEXT_FILE = path.join(os.homedir(), ".config", "vomit", "pi-context.json");
const STALE_MS = 12 * 60 * 60 * 1000; // ignore leftovers from a long-dead session

export default function (pi: any) {
  pi.on("before_agent_start", async () => {
    let ctx: any;
    try {
      if (Date.now() - fs.statSync(CONTEXT_FILE).mtimeMs > STALE_MS) return;
      ctx = JSON.parse(fs.readFileSync(CONTEXT_FILE, "utf-8"));
    } catch {
      return; // Vomit not running or no context yet — stay silent
    }
    if (!ctx || (!ctx.currentFilePath && !ctx.projectRoot && !ctx.currentDirectory)) return;

    // "The open folder" as the user thinks of it: the file-tree selection when
    // it points below the workspace root, else the open doc's folder, else root.
    const treeSelection =
      ctx.currentDirectory && ctx.currentDirectory !== ctx.projectRoot ? ctx.currentDirectory : null;
    const openFolder = treeSelection || ctx.basePath || ctx.projectRoot || ctx.currentDirectory;

    const lines = ["Live context from the Vomit editor this session runs inside:"];
    if (ctx.currentFilePath) lines.push("- Currently open document: " + ctx.currentFilePath);
    else lines.push("- No document is open right now.");
    if (openFolder) lines.push("- Currently open folder: " + openFolder);
    if (ctx.projectRoot && openFolder !== ctx.projectRoot)
      lines.push("- Workspace (bucket) root: " + ctx.projectRoot);
    lines.push(
      'When the user refers to "this doc"/"this file" or "this folder", they mean the ones above — ' +
      "answer from these lines directly. " +
      "This context changes when they switch tabs or folders, so trust this message over earlier ones. " +
      "Read the document from disk when its content is needed."
    );

    return {
      message: {
        customType: "vomit-context",
        content: lines.join("\\n"),
        display: false,
      },
    };
  });
}
`;

// Written every spawn so app updates propagate; cheap enough to not bother diffing.
function installExtension() {
  try {
    fs.mkdirSync(path.dirname(EXTENSION_FILE), { recursive: true });
    fs.writeFileSync(EXTENSION_FILE, EXTENSION_SOURCE, 'utf-8');
  } catch {
    /* pi still works, just without vomit awareness */
  }
}

function writeContext(ctx) {
  try {
    fs.mkdirSync(path.dirname(CONTEXT_FILE), { recursive: true });
    fs.writeFileSync(
      CONTEXT_FILE,
      JSON.stringify(
        {
          currentFilePath: ctx?.currentFilePath ?? null,
          basePath: ctx?.basePath ?? null,
          projectRoot: ctx?.projectRoot ?? null,
          currentDirectory: ctx?.currentDirectory ?? null,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf-8',
    );
  } catch {
    /* non-fatal — pi just sees the previous context */
  }
}

/**
 * Register pi terminal IPC handlers.
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ state: import('../../services/sessionState').SessionState, bus: import('../rendererBus').RendererBus, terminalService: any }} deps
 */
function registerHandlers(ipcMain, { state, bus, terminalService }) {
  // Renderer pushes fresh context on tab switch / file open / bucket change.
  ipcMain.on('pi-context-update', (event, ctx) => {
    writeContext(ctx);
  });

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

    installExtension();

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

    // GUI-launched apps on macOS get a stripped PATH without the homebrew/nvm
    // bin dir, so pi's `#!/usr/bin/env node` shebang fails with
    // "env: node: No such file or directory". node lives in the SAME bin dir as
    // the pi shim (true for homebrew, nvm, system, and npm-prefix installs), so
    // prepend that dir — plus the usual local bins — to the PATH we hand the PTY.
    const sep = process.platform === 'win32' ? ';' : ':';
    const extraPaths =
      process.platform === 'win32'
        ? [path.dirname(piPath)]
        : [path.dirname(piPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
    const mergedPath = [...extraPaths, process.env.PATH || ''].filter(Boolean).join(sep);

    state.piProcess = pty.spawn(file, spawnArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: workingDir,
      env: { ...process.env, TERM: 'xterm-256color', PATH: mergedPath },
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

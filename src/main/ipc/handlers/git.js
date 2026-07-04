// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const chokidar = require('chokidar');
const { findExecutable } = require('./ai');
const { parsePorcelainZ, classifyStatus, propagateToFolders, computeGutterLines } = require('../../services/gitUtils');

const GIT_TIMEOUT_MS = 5000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;
const LINE_DIFF_MAX_BUFFER = 2 * 1024 * 1024;
const WATCH_DEBOUNCE_MS = 300;
const FOCUS_THROTTLE_MS = 2000;

// Locate the git binary once. findExecutable covers the usual POSIX prefixes
// and a which/where fallback, but its Windows candidates are Ollama-specific —
// probe Git for Windows install paths first so packaged builds find it.
function findGitBinary() {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'git.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'cmd', 'git.exe')
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }
  return findExecutable('git');
}

/**
 * Main-process git service: repo detection, workspace status, line diffs for
 * the editor gutter, and watching .git/HEAD + .git/index for external changes.
 * Everything degrades silently when git is missing or the folder is not a repo.
 *
 * @param {{ state: import('../../services/sessionState').SessionState, bus: import('../rendererBus').RendererBus, configStore: typeof import('../../services/configStore') }} deps
 */
function createGitService({ state, bus, configStore }) {
  const gitPath = findGitBinary();

  /** @type {Map<string, {isRepo: boolean, root?: string, gitDir?: string}>} */
  const repoInfoCache = new Map();
  /** @type {import('chokidar').FSWatcher|null} */
  let gitWatcher = null;
  /** @type {string|null} root the watcher is currently armed for */
  let watchedRoot = null;
  /** @type {NodeJS.Timeout|null} */
  let emitTimer = null;
  let lastFocusEmit = 0;

  function runGit(args, cwd) {
    if (!gitPath) return Promise.resolve(null);
    return new Promise((resolve) => {
      execFile(
        gitPath,
        args,
        { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, windowsHide: true, encoding: 'utf8' },
        (err, stdout) => resolve(err ? null : stdout)
      );
    });
  }

  function emitStatusChanged(reason) {
    if (emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      bus.send('git-status-changed', { reason });
    }, WATCH_DEBOUNCE_MS);
  }

  /**
   * Detect the repo for a workspace root (cached per root). Resolves the real
   * git dir so worktrees/submodules (.git as a file) watch the right place.
   * @param {string|null} root
   */
  async function getRepoInfo(root) {
    if (!gitPath || !root) return { isRepo: false };
    // Only the workspace root drives the .git watcher; lookups for other
    // paths (e.g. the agent's cwd in the diff gate) must not re-arm it.
    const isWorkspaceRoot = root === currentRoot();
    const cached = repoInfoCache.get(root);
    if (cached) {
      if (isWorkspaceRoot) armWatcher(root, cached);
      return cached;
    }
    const out = await runGit(['rev-parse', '--absolute-git-dir', '--show-toplevel'], root);
    let info;
    if (!out) {
      info = { isRepo: false };
    } else {
      const [gitDir, toplevel] = out.trim().split('\n');
      info = gitDir && toplevel ? { isRepo: true, root: toplevel, gitDir } : { isRepo: false };
    }
    repoInfoCache.set(root, info);
    if (isWorkspaceRoot) armWatcher(root, info);
    return info;
  }

  // Watch the resolved gitdir's HEAD and index for external commits, branch
  // switches, staging, etc. One watcher, re-armed when the workspace changes.
  function armWatcher(root, info) {
    if (watchedRoot === root) return;
    if (gitWatcher) {
      gitWatcher.close();
      gitWatcher = null;
    }
    watchedRoot = root;
    if (!info.isRepo || !info.gitDir) return;
    const targets = [path.join(info.gitDir, 'HEAD'), path.join(info.gitDir, 'index')];
    gitWatcher = chokidar.watch(targets, { ignoreInitial: true, persistent: true });
    gitWatcher.on('all', () => emitStatusChanged('git'));
    gitWatcher.on('error', () => { /* watcher failure = silently degraded */ });
  }

  function currentRoot() {
    return state.currentProjectRoot || null;
  }

  /** Workspace status for file-tree badges. */
  async function getStatus() {
    const info = await getRepoInfo(currentRoot());
    if (!info.isRepo) return { isRepo: false, files: {}, folders: {} };

    const out = await runGit(['--no-optional-locks', 'status', '--porcelain=v1', '-z'], info.root);
    if (out == null) return { isRepo: false, files: {}, folders: {} };

    const statusMap = classifyStatus(parsePorcelainZ(out));
    const files = {};
    for (const [rel, status] of statusMap) {
      files[path.join(info.root, ...rel.split('/'))] = status;
    }
    const folders = {};
    for (const rel of propagateToFolders(statusMap)) {
      folders[path.join(info.root, ...rel.split('/'))] = 'modified';
    }
    return { isRepo: true, root: info.root, files, folders };
  }

  /** Line diff of a live buffer against HEAD, for the editor gutter. */
  async function getLineDiff(filePath, bufferContent) {
    const info = await getRepoInfo(currentRoot());
    if (!info.isRepo || !filePath) return { supported: false };
    const buffer = String(bufferContent == null ? '' : bufferContent);
    if (buffer.length > LINE_DIFF_MAX_BUFFER) return { supported: false };

    const relNative = path.relative(info.root, filePath);
    if (!relNative || relNative.startsWith('..') || path.isAbsolute(relNative)) {
      return { supported: false };
    }
    const rel = relNative.split(path.sep).join('/');

    let headText = await runGit(['show', `HEAD:${rel}`], info.root);
    if (headText == null) {
      // Not in HEAD: staged new file (or unborn HEAD) diffs against empty;
      // untracked files get no gutter at all.
      const inIndex = await runGit(['ls-files', '--error-unmatch', '--', rel], info.root);
      if (inIndex == null) return { supported: false };
      headText = '';
    }

    return { supported: true, ...computeGutterLines(headText, buffer) };
  }

  /** Nudge from outside (agent writes) — same debounced event. */
  function notifyExternalChange() {
    if (gitPath && watchedRoot) emitStatusChanged('agent-write');
  }

  /** Window focus — throttled so rapid focus flips don't spam git. */
  function onWindowFocus() {
    if (!gitPath) return;
    const now = Date.now();
    if (now - lastFocusEmit < FOCUS_THROTTLE_MS) return;
    lastFocusEmit = now;
    emitStatusChanged('focus');
  }

  function dispose() {
    if (gitWatcher) {
      gitWatcher.close();
      gitWatcher = null;
    }
    if (emitTimer) clearTimeout(emitTimer);
  }

  /** @param {import('electron').IpcMain} ipcMain */
  function registerHandlers(ipcMain) {
    ipcMain.handle('git-repo-info', async () => {
      const info = await getRepoInfo(currentRoot());
      return { isRepo: info.isRepo, root: info.root || null };
    });
    ipcMain.handle('git-status', () => getStatus());
    ipcMain.handle('git-line-diff', (event, filePath, bufferContent) => getLineDiff(filePath, bufferContent));
  }

  return {
    registerHandlers,
    getRepoInfo,
    getStatus,
    getLineDiff,
    notifyExternalChange,
    onWindowFocus,
    dispose
  };
}

module.exports = { createGitService };

#!/usr/bin/env node
'use strict';

/**
 * Verify (and self-repair) the Electron binary after npm install.
 *
 * Under some Node versions (observed on Node 26), Electron's own postinstall
 * silently fails mid-extraction: its extract-zip step stalls, Node exits 0
 * with the promise still pending, and node_modules/electron is left without
 * dist/ contents or path.txt. `npm start` then throws "Electron failed to
 * install correctly".
 *
 * This script runs as the project's postinstall. On a healthy install it is
 * a silent no-op. On a broken one it repairs from the already-downloaded zip
 * in @electron/get's cache (the download itself always succeeds — only the
 * extraction fails), falling back to re-running Electron's install script.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');

function log(msg) {
  process.stdout.write(`[verify-electron] ${msg}\n`);
}

function platformExecPath() {
  switch (process.platform) {
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'win32':
      return 'electron.exe';
    default:
      return 'electron';
  }
}

function isHealthy() {
  try {
    const pathTxt = fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf-8').trim();
    return pathTxt.length > 0 && fs.existsSync(path.join(electronDir, 'dist', pathTxt));
  } catch (_) {
    return false;
  }
}

function cacheRoot() {
  if (process.env.electron_config_cache) return process.env.electron_config_cache;
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Caches', 'electron');
    case 'win32':
      return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron', 'Cache');
    default:
      return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'electron');
  }
}

// The cache stores zips one directory level down (keyed by a URL hash).
function findCachedZip(zipName) {
  const root = cacheRoot();
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  const direct = path.join(root, zipName);
  if (fs.existsSync(direct)) return direct;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name, zipName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function extractZip(zipPath, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === 'darwin') {
    // ditto preserves symlinks and permissions inside .app bundles.
    execFileSync('ditto', ['-x', '-k', zipPath, destDir], { stdio: 'pipe' });
  } else if (process.platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`
    ], { stdio: 'pipe' });
  } else {
    execFileSync('unzip', ['-q', zipPath, '-d', destDir], { stdio: 'pipe' });
  }
}

function finalize() {
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformExecPath());
  // Electron's installer moves the type definitions up a level; mirror that.
  const srcDts = path.join(electronDir, 'dist', 'electron.d.ts');
  if (fs.existsSync(srcDts)) {
    fs.renameSync(srcDts, path.join(electronDir, 'electron.d.ts'));
  }
}

function repairFromCache() {
  const version = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf-8')).version;
  const arch = process.env.npm_config_arch || process.arch;
  const zipName = `electron-v${version}-${process.platform}-${arch}.zip`;
  const zipPath = findCachedZip(zipName);
  if (!zipPath) {
    log(`no cached ${zipName} found in ${cacheRoot()}`);
    return false;
  }
  log(`repairing from cache: ${zipPath}`);
  extractZip(zipPath, path.join(electronDir, 'dist'));
  finalize();
  return isHealthy();
}

function repairViaInstaller() {
  log('retrying Electron\'s own install script');
  const result = spawnSync(process.execPath, ['install.js'], { cwd: electronDir, stdio: 'pipe', timeout: 300000 });
  return result.status === 0 && isHealthy();
}

function main() {
  if (!fs.existsSync(electronDir)) return; // electron not installed at all — nothing to verify
  if (isHealthy()) return;

  log('Electron binary is missing or incomplete after install — attempting self-repair');
  try {
    if (repairFromCache()) {
      log('repaired from the download cache.');
      return;
    }
  } catch (e) {
    log(`cache repair failed: ${e.message}`);
  }
  try {
    if (repairViaInstaller()) {
      log('repaired via Electron\'s install script.');
      return;
    }
  } catch (e) {
    log(`installer retry failed: ${e.message}`);
  }

  log('could not repair automatically. Delete node_modules/electron and reinstall with a Node LTS (22/24):');
  log('  rm -rf node_modules/electron && npm install electron');
  process.exitCode = 1;
}

main();

const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const configStore = require('./services/configStore');
const bucketSetup = require('./services/bucketSetup');
const { SessionState } = require('./services/sessionState');
const { RendererBus } = require('./ipc/rendererBus');
const { createWindowManager } = require('./services/windowManager');
const { createFileService } = require('./ipc/handlers/file');
const { createPresentationService } = require('./ipc/handlers/presentation');
const { createBucketService } = require('./ipc/handlers/bucket');
const { createTerminalService } = require('./ipc/handlers/terminal');
const { createPermissionBroker } = require('./services/agentPermissions');
const { createGitService } = require('./ipc/handlers/git');
const aiHandlers = require('./ipc/handlers/ai');
const agentHandlers = require('./ipc/handlers/agent');
const shellHandlers = require('./ipc/handlers/shell');
const pseudoHandlers = require('./ipc/handlers/pseudo');
const rag = require('./rag');
const wiki = require('./wiki');
const menuModule = require('./menu');

// Set app name for About dialog
app.setName('Vomit');

const state = new SessionState();
const bus = new RendererBus();

// Initialize state from configStore
state.currentTheme = configStore.getTheme();
state.autoSaveEnabled = configStore.getAutoSaveEnabled();

const pendingOpenFiles = [];
let launchFilesConsumed = false;

function getLaunchFilePaths(argv) {
  const supportedExtensions = new Set(['.md', '.markdown', '.pdf', '.drawio', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif']);
  const executablePaths = new Set([process.argv[0], process.execPath].filter(Boolean).map(p => path.resolve(p)));
  return argv.filter(arg => {
    if (!arg || arg.startsWith('-')) return false;
    try {
      const resolved = path.resolve(arg);
      return !executablePaths.has(resolved) &&
        supportedExtensions.has(path.extname(arg).toLowerCase()) &&
        fs.existsSync(arg) &&
        fs.statSync(arg).isFile();
    } catch {
      return false;
    }
  });
}

function isSameOrSubPath(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function openExternalFile(filePath) {
  const activeBucket = configStore.getActiveBucket();
  const isOutsideBucket = !activeBucket || !isSameOrSubPath(filePath, activeBucket.path);

  if (bus.getMainWindow()) {
    fileService.loadFile(filePath);
    if (isOutsideBucket) {
      bus.send('file-outside-bucket', filePath);
    }
  } else {
    pendingOpenFiles.push(filePath);
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Another Vomit (packaged or `npm start`) already owns this profile. Say so
  // before exiting — a silent 0-exit looks like a broken install. One guarded
  // write, not console.log (see EPIPE note in CLAUDE.md).
  try { process.stdout.write('Vomit is already running — quit the other instance first. This one will exit.\n'); } catch (_) { /* stdout may be closed (e.g. Finder launch) */ }
  app.exit(0);
} else {
  app.on('second-instance', (_event, argv) => {
    for (const filePath of getLaunchFilePaths(argv)) {
      openExternalFile(filePath);
    }
    const win = bus.getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Create services (lazy refs resolve circular deps at call time)
function createMenu() { menuModule.createMenu(); }

const windowManager = createWindowManager({
  state, bus,
  getSaveFileAs: () => fileService.saveFileAs()
});

const fileService = createFileService({ state, bus, configStore });

const presentationService = createPresentationService({
  state, bus, configStore, windowManager
});

const bucketService = createBucketService({
  state, bus, configStore, menuModule
});

const terminalService = createTerminalService({
  state, bus, windowManager
});

// Permission broker for agent tool execution — prompts go to both terminal
// windows via syncTerminalOutput; answers come back over IPC (agent.js).
const permissionBroker = createPermissionBroker({
  sendOutput: (channel, ...args) => terminalService.syncTerminalOutput(channel, ...args),
  state
});

// Git awareness: repo status for tree badges, line diffs for the editor
// gutter, .git watching for external changes. Silently inert without git.
const gitService = createGitService({ state, bus, configStore });
app.on('browser-window-focus', () => gitService.onWindowFocus());
app.on('will-quit', () => gitService.dispose());

// Register menu module with all action references
menuModule.register({
  state,
  bus,
  configStore,
  actions: {
    createNewEditorWindow: windowManager.createNewEditorWindow,
    newFile: fileService.newFile,
    newPresentation: fileService.newPresentation,
    openFile: fileService.openFile,
    saveFile: fileService.saveFile,
    saveFileAs: fileService.saveFileAs,
    exportToPDF: presentationService.exportToPDF,
    sendFormatCommand: presentationService.sendFormatCommand,
    startPresentation: presentationService.startPresentation,
    startPresentationWithPresenter: presentationService.startPresentationWithPresenter,
    endPresentation: presentationService.endPresentation,
    setTheme: presentationService.setTheme,
    showHelp: presentationService.showHelp,
    showDocumentation: windowManager.createDocumentationWindow,
    switchBucket: bucketService.switchBucket,
    addBucket: bucketService.addBucket,
    removeBucket: bucketService.removeBucket,
  }
});

// Register IPC handlers
fileService.registerHandlers(ipcMain);
presentationService.registerHandlers(ipcMain);
bucketService.registerHandlers(ipcMain);
terminalService.registerHandlers(ipcMain);
aiHandlers.registerHandlers(ipcMain, { state, bus, configStore, terminalService, permissionBroker });
agentHandlers.registerHandlers(ipcMain, { state, bus, configStore, terminalService, permissionBroker, gitService });
gitService.registerHandlers(ipcMain);
shellHandlers.registerHandlers(ipcMain, { state, bus, terminalService });
pseudoHandlers.registerHandlers(ipcMain, { state, configStore });
rag.registerHandlers(ipcMain, { state, bus });
wiki.registerHandlers(ipcMain, { state, bus });

// App info handler
ipcMain.handle('get-app-version', () => app.getVersion());

// Command palette IPC handlers (mirroring menu actions that need main-process state)
ipcMain.on('show-documentation-window', () => {
  const manualPath = path.join(app.getAppPath(), 'manual.md');
  try {
    const content = fs.readFileSync(manualPath, 'utf8');
    windowManager.createDocumentationWindow(content);
  } catch (err) {
    windowManager.createDocumentationWindow('# Documentation\n\nManual not found.');
  }
});

ipcMain.on('set-auto-save-enabled', (event, enabled) => {
  state.autoSaveEnabled = !!enabled;
  configStore.setAutoSaveEnabled(state.autoSaveEnabled);
  bus.send('auto-save-changed', state.autoSaveEnabled);
  createMenu();
});

// Check for updates via GitHub releases
async function checkForUpdates() {
  try {
    const https = require('https');
    const currentVersion = app.getVersion();

    const options = {
      hostname: 'api.github.com',
      path: '/repos/jacqinthebox/vomit-vnext/releases/latest',
      headers: { 'User-Agent': 'Vomit-App' }
    };

    const data = await new Promise((resolve, reject) => {
      https.get(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });

    if (data.tag_name) {
      const latestVersion = data.tag_name.replace(/^v/, '');
      if (isNewerVersion(latestVersion, currentVersion)) {
        bus.send('update-available', { current: currentVersion, latest: latestVersion });
      }
    }
  } catch (err) {
    // Silently fail - update check is non-critical
  }
}

function isNewerVersion(latest, current) {
  const latestParts = latest.split('.').map(Number);
  const currentParts = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((latestParts[i] || 0) > (currentParts[i] || 0)) return true;
    if ((latestParts[i] || 0) < (currentParts[i] || 0)) return false;
  }
  return false;
}

// Helper to find first valid bucket
function findFirstValidBucket() {
  const buckets = configStore.getBuckets();
  for (let i = 0; i < buckets.length; i++) {
    if (bucketSetup.isBucketValid(buckets[i].path)) {
      return { bucket: buckets[i], index: i };
    }
  }
  return null;
}

// Register custom protocol for serving local files (images etc.) in packaged app
protocol.registerSchemesAsPrivileged([
  { scheme: 'vomit-file', privileges: { secure: true, supportFetchAPI: true, bypassCSP: false, stream: true } }
]);

// App lifecycle
app.whenReady().then(async () => {
  // Handle local file requests (e.g. images in markdown preview)
  protocol.handle('vomit-file', (request) => {
    const rawPath = request.url.slice('vomit-file://'.length);
    let filePath;
    try {
      filePath = decodeURIComponent(rawPath);
    } catch {
      filePath = rawPath;
    }
    return net.fetch(pathToFileURL(filePath).href);
  });
  aiHandlers.detectAITools(state);

  // Get active bucket from new multi-bucket system
  let activeBucket = configStore.getActiveBucket();

  // No buckets configured - show setup dialog
  if (!activeBucket) {
    const bucketPath = await bucketSetup.showBucketSetupDialog(null);

    if (!bucketPath) {
      app.quit();
      return;
    }

    // Add as first bucket
    configStore.addBucket({
      name: path.basename(bucketPath),
      path: bucketPath
    });
    configStore.setActiveBucketIndex(0);
    activeBucket = configStore.getActiveBucket();
  }

  // Validate active bucket still exists on disk
  if (!bucketSetup.isBucketValid(activeBucket.path)) {
    const validBucket = findFirstValidBucket();

    if (validBucket) {
      configStore.setActiveBucketIndex(validBucket.index);
      activeBucket = validBucket.bucket;
    } else {
      // All buckets invalid - show setup
      const bucketPath = await bucketSetup.showBucketSetupDialog(null);

      if (!bucketPath) {
        app.quit();
        return;
      }

      configStore.setBuckets([{ name: path.basename(bucketPath), path: bucketPath }]);
      configStore.setActiveBucketIndex(0);
      activeBucket = configStore.getActiveBucket();
    }
  }

  // Set bucket as project root
  state.currentProjectRoot = activeBucket.path;

  createMenu();
  windowManager.createMainWindow();

  // Auto-open bucket (on initial load and reload)
  bus.getMainWindow().webContents.on('did-finish-load', () => {
    bus.send('open-folder', activeBucket.path);
    bus.getMainWindow()?.setTitle(`${activeBucket.name} - Vomit`);

    for (const filePath of pendingOpenFiles.splice(0)) {
      openExternalFile(filePath);
    }

    if (process.platform !== 'darwin' && !launchFilesConsumed) {
      launchFilesConsumed = true;
      for (const filePath of getLaunchFilePaths(process.argv)) {
        openExternalFile(filePath);
      }
    }

    // Build the wikilink index in the background so [[ autocomplete and the
    // backlinks panel work immediately. Best-effort — never blocks startup.
    setTimeout(() => {
      wiki.indexBucket(activeBucket.path).then(() => {
        bus.send('wiki-changed', { type: 'reindex' });
        bus.sendToTerminal('wiki-changed', { type: 'reindex' });
      }).catch(() => {});
    }, 500);
  });

  // Check for updates after a short delay (only once on startup)
  setTimeout(checkForUpdates, 3000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  openExternalFile(filePath);
});

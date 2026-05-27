const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const configStore = require('./services/configStore');
const bucketSetup = require('./services/bucketSetup');
const { SessionState } = require('./services/sessionState');
const { RendererBus } = require('./ipc/rendererBus');
const { createWindowManager } = require('./services/windowManager');
const { createFileService } = require('./ipc/handlers/file');
const { createPresentationService } = require('./ipc/handlers/presentation');
const { createBucketService } = require('./ipc/handlers/bucket');
const { createTerminalService } = require('./ipc/handlers/terminal');
const aiHandlers = require('./ipc/handlers/ai');
const agentHandlers = require('./ipc/handlers/agent');
const shellHandlers = require('./ipc/handlers/shell');
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
aiHandlers.registerHandlers(ipcMain, { state, bus, configStore, terminalService });
agentHandlers.registerHandlers(ipcMain, { state, bus, configStore, terminalService });
shellHandlers.registerHandlers(ipcMain, { state, bus, terminalService });
rag.registerHandlers(ipcMain, { state, bus });
wiki.registerHandlers(ipcMain, { state, bus });

// App info handler
ipcMain.handle('get-app-version', () => app.getVersion());

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
    const filePath = decodeURIComponent(request.url.slice('vomit-file://'.length));
    return net.fetch(`file://${filePath}`);
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
  const activeBucket = configStore.getActiveBucket();
  const isOutsideBucket = !activeBucket || !filePath.startsWith(activeBucket.path);

  if (bus.getMainWindow()) {
    fileService.loadFile(filePath);
    if (isOutsideBucket) {
      bus.send('file-outside-bucket', filePath);
    }
  } else {
    app.whenReady().then(() => {
      fileService.loadFile(filePath);
      if (isOutsideBucket) {
        bus.send('file-outside-bucket', filePath);
      }
    });
  }
});

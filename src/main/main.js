const { app, BrowserWindow, ipcMain } = require('electron');
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
const aiHandlers = require('./ipc/handlers/ai');
const agentHandlers = require('./ipc/handlers/agent');
const shellHandlers = require('./ipc/handlers/shell');
const rag = require('./rag');
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
aiHandlers.registerHandlers(ipcMain, { state, bus, configStore });
agentHandlers.registerHandlers(ipcMain, { state, bus, configStore });
shellHandlers.registerHandlers(ipcMain, { state, bus });
rag.registerHandlers(ipcMain, { state, bus });

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

// App lifecycle
app.whenReady().then(async () => {
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

  // Auto-open bucket
  bus.getMainWindow().webContents.once('did-finish-load', () => {
    bus.send('open-folder', activeBucket.path);
    bus.getMainWindow()?.setTitle(`${activeBucket.name} - Vomit`);
  });

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
  // Only open if within active bucket
  if (activeBucket && filePath.startsWith(activeBucket.path)) {
    if (bus.getMainWindow()) {
      fileService.loadFile(filePath);
    } else {
      app.whenReady().then(() => {
        fileService.loadFile(filePath);
      });
    }
  }
});

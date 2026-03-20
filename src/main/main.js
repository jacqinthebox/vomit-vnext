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
  }
});

// Register IPC handlers
fileService.registerHandlers(ipcMain);
presentationService.registerHandlers(ipcMain);
aiHandlers.registerHandlers(ipcMain, { state, bus, configStore });
agentHandlers.registerHandlers(ipcMain, { state, bus, configStore });
shellHandlers.registerHandlers(ipcMain, { state, bus });
rag.registerHandlers(ipcMain, { state, bus });

// App lifecycle
app.whenReady().then(async () => {
  aiHandlers.detectAITools(state);

  // Check bucket configuration
  let bucketPath = configStore.getBucketPath();

  if (!bucketSetup.isBucketValid(bucketPath)) {
    // First run or bucket deleted - show setup dialog
    bucketPath = await bucketSetup.showBucketSetupDialog(null);

    if (!bucketPath) {
      // User cancelled setup - quit app
      app.quit();
      return;
    }

    configStore.setBucketPath(bucketPath);
  }

  // Set bucket as project root
  state.currentProjectRoot = bucketPath;

  createMenu();
  windowManager.createMainWindow();

  // Auto-open bucket
  bus.getMainWindow().webContents.once('did-finish-load', () => {
    bus.send('open-folder', bucketPath);
    bus.getMainWindow()?.setTitle(`${path.basename(bucketPath)} - Vomit`);
  });

  // Handle file open from command line or Finder (only within bucket)
  const args = process.argv.slice(2);
  if (args.length > 0 && fs.existsSync(args[0])) {
    const targetPath = path.resolve(args[0]);
    // Only open if it's within the bucket
    if (targetPath.startsWith(bucketPath)) {
      const stats = fs.statSync(targetPath);
      if (!stats.isDirectory()) {
        fileService.loadFile(targetPath);
      }
    }
  }

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
  const bucketPath = configStore.getBucketPath();
  // Only open if within bucket
  if (bucketPath && filePath.startsWith(bucketPath)) {
    if (bus.getMainWindow()) {
      fileService.loadFile(filePath);
    } else {
      app.whenReady().then(() => {
        fileService.loadFile(filePath);
      });
    }
  }
});

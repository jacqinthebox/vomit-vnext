const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const configStore = require('./services/configStore');
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

const fileService = createFileService({ state, bus, configStore, createMenu });

const presentationService = createPresentationService({
  state, bus, configStore, windowManager
});

// Register menu module with all action references
menuModule.register({
  state,
  bus,
  configStore,
  actions: {
    loadFile: fileService.loadFile,
    createNewEditorWindow: windowManager.createNewEditorWindow,
    newFile: fileService.newFile,
    newPresentation: fileService.newPresentation,
    openFile: fileService.openFile,
    openFolder: fileService.openFolder,
    saveFile: fileService.saveFile,
    saveFileAs: fileService.saveFileAs,
    exportToPDF: presentationService.exportToPDF,
    sendFormatCommand: presentationService.sendFormatCommand,
    startPresentation: presentationService.startPresentation,
    startPresentationWithPresenter: presentationService.startPresentationWithPresenter,
    endPresentation: presentationService.endPresentation,
    setTheme: presentationService.setTheme,
    showHelp: presentationService.showHelp,
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
app.whenReady().then(() => {
  aiHandlers.detectAITools(state);
  createMenu();
  windowManager.createMainWindow();

  // Handle file/folder open from command line or Finder
  const args = process.argv.slice(2);
  if (args.length > 0 && fs.existsSync(args[0])) {
    const targetPath = path.resolve(args[0]);
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      // Open folder
      state.currentProjectRoot = targetPath;
      configStore.setLastOpenedFolder(targetPath);
      bus.getMainWindow().webContents.once('did-finish-load', () => {
        bus.send('open-folder', targetPath);
        bus.getMainWindow()?.setTitle(`${path.basename(targetPath)} - Vomit`);
      });
    } else {
      // Open file
      fileService.loadFile(targetPath);
    }
  } else {
    // Try to restore last session (folder first, then file)
    const lastFolder = configStore.getLastOpenedFolder();
    const lastFile = configStore.getLastOpenedFile();

    if (lastFolder && fs.existsSync(lastFolder)) {
      state.currentProjectRoot = lastFolder;
      bus.getMainWindow().webContents.once('did-finish-load', () => {
        bus.send('open-folder', lastFolder);
        bus.getMainWindow()?.setTitle(`${path.basename(lastFolder)} - Vomit`);
        // Also load last file if it's within the folder
        if (lastFile && fs.existsSync(lastFile) && lastFile.startsWith(lastFolder)) {
          fileService.loadFile(lastFile);
        }
      });
    } else if (lastFile && fs.existsSync(lastFile)) {
      fileService.loadFile(lastFile);
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
  if (bus.getMainWindow()) {
    fileService.loadFile(filePath);
  } else {
    app.whenReady().then(() => {
      fileService.loadFile(filePath);
    });
  }
});

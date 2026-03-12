const { app, BrowserWindow, Menu, dialog, ipcMain, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const pty = require('node-pty');
const configStore = require('./services/configStore');
const { SessionState } = require('./services/sessionState');
const { RendererBus } = require('./ipc/rendererBus');
const rag = require('./rag');
const shellHandlers = require('./ipc/handlers/shell');
const menuModule = require('./menu');

// Set app name for About dialog
app.setName('Vomit');

const state = new SessionState();
const bus = new RendererBus();

// Initialize state from configStore
state.currentTheme = configStore.getTheme();
state.autoSaveEnabled = configStore.getAutoSaveEnabled();

// Register extracted IPC handler modules
shellHandlers.registerHandlers(ipcMain, { state, bus });

let fileWatcher = null; // Watch for external file changes

// Find executable path
function findExecutable(name) {
  const exe = name;

  // Check common locations directly (packaged apps have limited PATH)
  const commonPaths = [
    `/opt/homebrew/bin/${name}`,  // Apple Silicon homebrew
    `/usr/local/bin/${name}`,      // Intel homebrew / Linux
    `/usr/bin/${name}`,            // System
    `${process.env.HOME}/.local/bin/${name}` // User local
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Fallback to which
  const { execSync } = require('child_process');
  try {
    const result = execSync(`which ${name}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0];
    return result || null;
  } catch (e) {
    return null;
  }
}

// Get list of installed Ollama models
function getOllamaModels(ollamaPath) {
  if (!ollamaPath) return [];
  const { execSync } = require('child_process');
  try {
    const result = execSync(`"${ollamaPath}" list`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
    const lines = result.trim().split('\n');
    // Skip header line, parse model names
    const models = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(/\s+/);
      if (parts[0]) {
        models.push(parts[0]); // Model name is first column
      }
    }
    return models;
  } catch (e) {
    return [];
  }
}

// Detect available Ollama installation and models
function detectAITools() {
  state.availableAITools.ollama = findExecutable('ollama');
  state.availableAITools.ollamaModels = getOllamaModels(state.availableAITools.ollama);

  return state.availableAITools;
}

// Build AI submenu dynamically based on available Ollama models
function createMainWindow() {
  const iconPath = path.join(__dirname, '../icon.png');

  // Set dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(iconPath);
  }

  bus.setMainWindow(new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: 'Vomit',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 }
  }));

  bus.getMainWindow().loadFile(path.join(__dirname, '../renderer/index.html'));

  // Warning for unsaved untitled files
  bus.getMainWindow().on('close', async (e) => {
    if (!state.currentFilePath && state.currentContent && state.currentContent.trim()) {
      e.preventDefault();
      const result = await dialog.showMessageBox(bus.getMainWindow(), {
        type: 'warning',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Unsaved Changes',
        message: 'Do you want to save your changes?',
        detail: 'Your changes will be lost if you close without saving.'
      });

      if (result.response === 0) {
        // Save
        await saveFileAs();
        bus.getMainWindow().destroy();
      } else if (result.response === 1) {
        // Don't Save
        bus.getMainWindow().destroy();
      }
      // Cancel: do nothing, window stays open
    }
  });

  bus.getMainWindow().on('closed', () => {
    bus.setMainWindow(null);
    if (bus.getPresentationWindow()) bus.getPresentationWindow().close();
    if (bus.getPresenterWindow()) bus.getPresenterWindow().close();
  });

  bus.getMainWindow().webContents.on('did-finish-load', () => {
    // Apply saved theme
    bus.send('set-theme', state.currentTheme);

    if (state.currentFilePath && state.currentContent) {
      const basePath = path.dirname(state.currentFilePath);
      bus.send('load-content', state.currentContent, state.currentFilePath, basePath);
    }
  });
}

function createNewEditorWindow() {
  const iconPath = path.join(__dirname, '../icon.png');

  const newWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: 'Vomit',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 }
  });

  newWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  newWindow.webContents.on('did-finish-load', () => {
    newWindow.webContents.send('set-theme', state.currentTheme);
  });

  newWindow.on('closed', () => {
    const wins = bus.getEditorWindows();
    const idx = wins.indexOf(newWindow);
    if (idx !== -1) wins.splice(idx, 1);
  });

  bus.getEditorWindows().push(newWindow);
  return newWindow;
}

function createPresentationWindow() {
  bus.setPresentationWindow(new BrowserWindow({
    width: 1280,
    height: 720,
    title: 'Presentation',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#1e1e1e'
  }));

  bus.getPresentationWindow().loadFile(path.join(__dirname, '../renderer/presentation.html'));

  bus.getPresentationWindow().on('closed', () => {
    bus.setPresentationWindow(null);
  });

  return bus.getPresentationWindow();
}

function createPresenterWindow() {
  bus.setPresenterWindow(new BrowserWindow({
    width: 1000,
    height: 700,
    title: 'Presenter View',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#2d2d2d'
  }));

  bus.getPresenterWindow().loadFile(path.join(__dirname, '../renderer/presenter.html'));

  bus.getPresenterWindow().on('closed', () => {
    bus.setPresenterWindow(null);
  });

  return bus.getPresenterWindow();
}

function createMenu() {
  menuModule.createMenu();
}

async function newFile() {
  state.currentFilePath = null;
  state.currentContent = '';
  bus.send('load-content', '', null);
  bus.getMainWindow()?.setTitle('Untitled - Vomit');
}

async function newPresentation() {
  state.currentFilePath = null;
  const template = `---
theme: catppuccin
font-size: 16px
---

# Welcome to Your Presentation

Your first slide content goes here.

Use **Cmd+Shift+P** to start presenting.

???

Speaker notes go here. Only visible in presenter view.

---

# Second Slide

- Use \`---\` to separate slides
- Add speaker notes after \`???\`
- Press **L** for laser pointer during presentation

???

These are your private notes for this slide.

---

# Code Example

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

---

# Thank You!

Questions?
`;
  state.currentContent = template;
  bus.send('load-content', template, null);
  bus.getMainWindow()?.setTitle('Untitled Presentation - Vomit');
}

async function openFile() {
  const result = await dialog.showOpenDialog(bus.getMainWindow(), {
    title: 'Open Markdown File',
    filters: [
      { name: 'Markdown Files', extensions: ['md', 'markdown'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    loadFile(filePath);
  }
}

async function openFolder() {
  const result = await dialog.showOpenDialog(bus.getMainWindow(), {
    title: 'Open Folder',
    properties: ['openDirectory', 'createDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    state.currentProjectRoot = folderPath;
    configStore.setLastOpenedFolder(folderPath);
    bus.send('open-folder', folderPath);
    bus.getMainWindow()?.setTitle(`${path.basename(folderPath)} - Vomit`);
  }
}


function stopFileWatcher() {
  if (state.watchedFilePath) {
    try {
      fs.unwatchFile(state.watchedFilePath);
    } catch (err) {
      // Ignore errors when unwatching
    }
    state.watchedFilePath = null;
  }
  state.lastKnownMtime = null;
}

function startFileWatcher(filePath) {
  // Don't restart if already watching this file
  if (state.watchedFilePath === filePath) {
    return;
  }

  stopFileWatcher();

  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  try {
    // Get initial modification time
    state.lastKnownMtime = fs.statSync(filePath).mtimeMs;
    state.watchedFilePath = filePath;

    // Use fs.watchFile (polling) instead of fs.watch - more reliable on macOS
    fs.watchFile(filePath, { interval: 1000 }, (curr, prev) => {
      // File was modified externally
      if (curr.mtimeMs !== state.lastKnownMtime && curr.mtimeMs !== prev.mtimeMs) {
        state.lastKnownMtime = curr.mtimeMs;

        bus.send('file-changed-externally', filePath);
      }
    });
  } catch (err) {
    // Ignore file watch errors
  }
}

function loadFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    state.currentFilePath = filePath;
    state.currentContent = content;

    // Save as last opened file and add to recent
    configStore.setLastOpenedFile(filePath);
    configStore.addRecentFile(filePath);
    createMenu();

    // Start watching for external changes
    startFileWatcher(filePath);

    const basePath = path.dirname(filePath);
    bus.send('load-content', content, filePath, basePath);
    bus.getMainWindow()?.setTitle(`${path.basename(filePath)} - Vomit`);
  } catch (err) {
    dialog.showErrorBox('Error', `Failed to open file: ${err.message}`);
  }
}

async function saveFile() {
  if (!state.currentFilePath) {
    return saveFileAs();
  }

  bus.send('request-content');
}

async function saveFileAs() {
  // Default to project root if available, otherwise use current file's directory
  let defaultPath = 'untitled.md';
  if (state.currentFilePath) {
    defaultPath = state.currentFilePath;
  } else if (state.currentProjectRoot) {
    defaultPath = path.join(state.currentProjectRoot, 'untitled.md');
  }

  const result = await dialog.showSaveDialog(bus.getMainWindow(), {
    title: 'Save Markdown File',
    filters: [
      { name: 'Markdown Files', extensions: ['md'] }
    ],
    defaultPath
  });

  if (!result.canceled && result.filePath) {
    state.currentFilePath = result.filePath;
    // Notify renderer of new file path so tab can update
    bus.send('file-saved-as', result.filePath);
    bus.send('request-content');
    // Refresh file tree after save completes
    setTimeout(() => {
      bus.send('refresh-file-tree');
    }, 100);
  }
}

function writeFile(content) {
  if (!state.currentFilePath) return;

  try {
    // Check if file was modified externally before saving
    if (fs.existsSync(state.currentFilePath) && state.lastKnownMtime) {
      const currentMtime = fs.statSync(state.currentFilePath).mtimeMs;
      if (currentMtime !== state.lastKnownMtime) {
        // File changed externally - notify renderer instead of overwriting
        bus.send('file-changed-externally', state.currentFilePath);
        return; // Don't overwrite
      }
    }

    fs.writeFileSync(state.currentFilePath, content, 'utf-8');
    state.currentContent = content;

    // Update mtime to avoid detecting our own save as external change
    state.lastKnownMtime = fs.statSync(state.currentFilePath).mtimeMs;

    bus.getMainWindow()?.setTitle(`${path.basename(state.currentFilePath)} - Vomit`);
  } catch (err) {
    dialog.showErrorBox('Error', `Failed to save file: ${err.message}`);
  }
}

function startPresentation() {
  if (!bus.getPresentationWindow()) {
    createPresentationWindow();
  }

  const basePath = state.currentFilePath ? path.dirname(state.currentFilePath) : null;

  bus.getPresentationWindow().webContents.on('did-finish-load', () => {
    bus.sendToPresentation('load-presentation', state.currentContent, basePath);
    bus.getPresentationWindow().setFullScreen(true);
  });

  if (bus.getPresentationWindow().webContents.isLoading()) {
    // Will be handled by the did-finish-load event
  } else {
    bus.sendToPresentation('load-presentation', state.currentContent, basePath);
    bus.getPresentationWindow().setFullScreen(true);
  }

  bus.getPresentationWindow().focus();
}

function startPresentationWithPresenter() {
  if (!bus.getPresentationWindow()) {
    createPresentationWindow();
  }
  if (!bus.getPresenterWindow()) {
    createPresenterWindow();
  }

  const basePath = state.currentFilePath ? path.dirname(state.currentFilePath) : null;

  const loadContent = () => {
    bus.sendToPresentation('load-presentation', state.currentContent, basePath);
    bus.sendToPresenter('load-presentation', state.currentContent, basePath);
  };

  let loadedCount = 0;
  const checkLoaded = () => {
    loadedCount++;
    if (loadedCount >= 2) {
      loadContent();
    }
  };

  if (!bus.getPresentationWindow().webContents.isLoading()) {
    checkLoaded();
  } else {
    bus.getPresentationWindow().webContents.once('did-finish-load', checkLoaded);
  }

  if (!bus.getPresenterWindow().webContents.isLoading()) {
    checkLoaded();
  } else {
    bus.getPresenterWindow().webContents.once('did-finish-load', checkLoaded);
  }

  bus.getPresentationWindow().focus();
}

function endPresentation() {
  if (bus.getPresentationWindow()) {
    bus.getPresentationWindow().setFullScreen(false);
    bus.getPresentationWindow().close();
  }
  if (bus.getPresenterWindow()) {
    bus.getPresenterWindow().close();
  }
}

function sendFormatCommand(command) {
  bus.send('format-command', command);
}

async function exportToPDF() {
  if (!state.currentContent) {
    dialog.showMessageBox(bus.getMainWindow(), {
      type: 'warning',
      title: 'No Content',
      message: 'Nothing to export. Please open or create a presentation first.'
    });
    return;
  }

  // Ask where to save
  const defaultName = state.currentFilePath
    ? path.basename(state.currentFilePath, '.md') + '.pdf'
    : 'presentation.pdf';

  const result = await dialog.showSaveDialog(bus.getMainWindow(), {
    title: 'Export to PDF',
    defaultPath: defaultName,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });

  if (result.canceled || !result.filePath) return;

  // Create hidden window for PDF rendering
  const pdfWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  pdfWindow.loadFile(path.join(__dirname, '../renderer/pdf-export.html'));

  const basePath = state.currentFilePath ? path.dirname(state.currentFilePath) : null;

  pdfWindow.webContents.on('did-finish-load', async () => {
    // Send content to render
    pdfWindow.webContents.send('render-for-pdf', state.currentContent, basePath);

    // Wait for rendering to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      const pdfData = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        landscape: true,
        pageSize: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      });

      fs.writeFileSync(result.filePath, pdfData);

      dialog.showMessageBox(bus.getMainWindow(), {
        type: 'info',
        title: 'Export Complete',
        message: `PDF exported successfully to:\n${result.filePath}`
      });
    } catch (err) {
      dialog.showErrorBox('Export Failed', `Failed to export PDF: ${err.message}`);
    } finally {
      pdfWindow.close();
    }
  });
}

function setTheme(theme) {
  state.currentTheme = theme;
  configStore.setTheme(theme);

  bus.send('set-theme', theme);
  bus.sendToPresentation('set-theme', theme);
  bus.sendToPresenter('set-theme', theme);
}

function showHelp() {
  shell.openExternal('https://github.com/jacqinthebox/vomit-vnext/blob/main/README.md');
}

// IPC Handlers
ipcMain.on('save-content', (event, content) => {
  writeFile(content);
});

ipcMain.on('open-file-path', (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    loadFile(filePath);
  }
});

ipcMain.on('content-changed', (event, content) => {
  state.currentContent = content;
  // Sync to presentation windows if open
  bus.sendToPresentation('update-content', content);
  bus.sendToPresenter('update-content', content);
});

// Update file watcher when active file changes (e.g., tab switch)
ipcMain.on('watch-file', (event, filePath) => {
  startFileWatcher(filePath);
});

// Sync current file path when switching tabs
ipcMain.on('set-current-file', (event, filePath) => {
  state.currentFilePath = filePath;
  if (filePath) {
    state.currentContent = '';
    try {
      state.currentContent = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {}
  }
});

// Get auto-save state
ipcMain.handle('get-auto-save-enabled', () => {
  return state.autoSaveEnabled;
});

// Get recent files
ipcMain.handle('get-recent-files', () => {
  const recentFiles = configStore.getRecentFiles();
  return recentFiles
    .filter(f => fs.existsSync(f))
    .map(f => ({ path: f, name: path.basename(f) }));
});

// Check if there's a last session to restore
ipcMain.handle('has-last-session', () => {
  const lastFolder = configStore.getLastOpenedFolder();
  const lastFile = configStore.getLastOpenedFile();
  return (lastFolder && fs.existsSync(lastFolder)) || (lastFile && fs.existsSync(lastFile));
});

// Command palette IPC handlers
ipcMain.on('new-file', () => newFile());
ipcMain.on('new-presentation', () => newPresentation());
ipcMain.on('open-file-dialog', () => openFile());
ipcMain.on('open-folder-dialog', () => openFolder());
ipcMain.on('save-as', () => saveFileAs());

// Reload file from disk (for external changes)
ipcMain.handle('reload-file', async (event, filePath) => {
  const pathToReload = filePath || state.currentFilePath;
  if (!pathToReload || !fs.existsSync(pathToReload)) {
    return { success: false, error: 'File not found' };
  }

  try {
    const content = fs.readFileSync(pathToReload, 'utf-8');
    state.lastKnownMtime = fs.statSync(pathToReload).mtimeMs;
    if (pathToReload === state.currentFilePath) {
      state.currentContent = content;
    }
    return { success: true, content };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.on('start-presentation', () => {
  startPresentation();
});

ipcMain.on('start-presentation-with-presenter', () => {
  startPresentationWithPresenter();
});

ipcMain.on('navigate-slide', (event, direction) => {
  bus.sendToPresentation('navigate-slide', direction);
  bus.sendToPresenter('navigate-slide', direction);
});

ipcMain.on('go-to-slide', (event, index) => {
  bus.sendToPresentation('go-to-slide', index);
  bus.sendToPresenter('go-to-slide', index);
});

// Open external links
ipcMain.handle('open-external', async (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    await shell.openExternal(url);
  }
});

// Get directory contents for file tree
ipcMain.handle('get-directory-contents', async (event, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items = entries
      .filter(entry => !entry.name.startsWith('.')) // Hide hidden files
      .map(entry => ({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        isDirectory: entry.isDirectory(),
        isMarkdown: !entry.isDirectory() && (entry.name.endsWith('.md') || entry.name.endsWith('.markdown'))
      }))
      .sort((a, b) => {
        // Directories first, then files
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
    return items;
  } catch (err) {
    console.error('Failed to read directory:', err);
    return [];
  }
});

// Get current file directory
ipcMain.handle('get-current-directory', async () => {
  if (state.currentFilePath) {
    return path.dirname(state.currentFilePath);
  }
  return null;
});

// Rename file or folder
ipcMain.handle('rename-item', async (event, oldPath, newName) => {
  try {
    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, newName);

    if (fs.existsSync(newPath)) {
      return { success: false, error: 'A file with that name already exists' };
    }

    fs.renameSync(oldPath, newPath);

    // Update currentFilePath if we renamed the open file
    if (state.currentFilePath === oldPath) {
      state.currentFilePath = newPath;
      bus.getMainWindow()?.setTitle(`${path.basename(newPath)} - Vomit`);
    }

    return { success: true, newPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Delete file or folder
ipcMain.handle('delete-item', async (event, itemPath) => {
  try {
    const result = await dialog.showMessageBox(bus.getMainWindow(), {
      type: 'warning',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
      title: 'Delete',
      message: `Delete "${path.basename(itemPath)}"?`,
      detail: 'This action cannot be undone.'
    });

    if (result.response === 1) {
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) {
        fs.rmSync(itemPath, { recursive: true });
      } else {
        fs.unlinkSync(itemPath);
      }
      return { success: true };
    }
    return { success: false, cancelled: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Show in Finder/Explorer
ipcMain.handle('show-in-finder', async (event, itemPath) => {
  shell.showItemInFolder(itemPath);
});

// Search in files
ipcMain.handle('search-in-files', async (event, dirPath, query) => {
  if (!query || query.length < 2) return [];

  const results = [];
  const searchQuery = query.toLowerCase();

  function searchDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          searchDir(fullPath); // Recurse into subdirectories
        } else if (entry.name.endsWith('.md') || entry.name.endsWith('.markdown')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            const matches = [];

            lines.forEach((line, index) => {
              if (line.toLowerCase().includes(searchQuery)) {
                matches.push({
                  line: index + 1,
                  text: line.trim().substring(0, 100)
                });
              }
            });

            if (matches.length > 0) {
              results.push({
                file: entry.name,
                path: fullPath,
                matches: matches.slice(0, 10) // Limit matches per file
              });
            }
          } catch (err) {
            // Skip files that can't be read
          }
        }
      }
    } catch (err) {
      // Skip directories that can't be read
    }
  }

  searchDir(dirPath);
  return results;
});

// Image handling
ipcMain.handle('save-image', async (event, imageData, suggestedName) => {
  try {
    // Determine save location - use folder next to current file, or temp
    let imagesDir;
    if (state.currentFilePath) {
      imagesDir = path.join(path.dirname(state.currentFilePath), 'images');
    } else {
      imagesDir = path.join(app.getPath('temp'), 'vomit-images');
    }

    // Create images directory if it doesn't exist
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const filename = suggestedName || `image-${timestamp}.png`;
    const filepath = path.join(imagesDir, filename);

    // Remove data URL prefix if present
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    fs.writeFileSync(filepath, buffer);

    // Return relative path if we have a current file, otherwise absolute
    if (state.currentFilePath) {
      return `images/${filename}`;
    }
    return filepath;
  } catch (err) {
    console.error('Failed to save image:', err);
    return null;
  }
});

// Unsaved changes dialog for tabs
ipcMain.handle('show-unsaved-dialog', async (event, filename) => {
  const result = await dialog.showMessageBox(bus.getMainWindow(), {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Unsaved Changes',
    message: `Do you want to save changes to ${filename || 'Untitled'}?`,
    detail: 'Your changes will be lost if you don\'t save them.'
  });

  if (result.response === 0) return 'save';
  if (result.response === 1) return 'discard';
  return 'cancel';
});

// Request save from renderer (for tab close with save)
ipcMain.handle('request-save', async () => {
  return new Promise((resolve) => {
    bus.send('request-content');
    // The save will happen, resolve after a short delay
    setTimeout(resolve, 200);
  });
});

rag.registerHandlers(ipcMain, { state, bus });

// Ollama execution using node-pty for proper TTY support
ipcMain.handle('claude-execute', async (event, command, cwd) => {
  const ollamaModel = configStore.getOllamaModel();

  return new Promise((resolve, reject) => {
    // Kill any existing process
    if (state.ollamaProcess) {
      state.ollamaProcess.kill();
      state.ollamaProcess = null;
    }

    const execPath = state.availableAITools.ollama;
    if (!execPath) {
      bus.send('claude-error', 'Ollama is not installed. Install it from https://ollama.ai\n');
      bus.send('claude-done', 1);
      resolve(1);
      return;
    }
    if (state.availableAITools.ollamaModels.length === 0) {
      bus.send('claude-error', `No Ollama models found. Run: ollama pull llama3.2\n`);
      bus.send('claude-done', 1);
      resolve(1);
      return;
    }
    if (!ollamaModel) {
      bus.send('claude-error', 'No AI model selected. Select one from the AI menu.\n');
      bus.send('claude-done', 1);
      resolve(1);
      return;
    }

    const args = ['run', ollamaModel, command];

    // Spawn Ollama with PTY for proper terminal emulation
    state.ollamaProcess = pty.spawn(execPath, args, {
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      cwd: cwd,
      env: { ...process.env }
    });

    state.ollamaProcess.onData((data) => {
        // Clean ANSI escape codes and spinner characters but preserve newlines and spaces
        let cleanData = data
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')   // ANSI escape codes (colors, cursor, etc.)
          .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '') // Extended ANSI codes (DEC private modes)
          .replace(/\x1b\][^\x07]*\x07/g, '')      // OSC sequences (title, etc.)
          .replace(/\x1b\][^\x1b]*\x1b\\/g, '')    // OSC sequences with ST terminator
          .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')// DCS, SOS, PM, APC sequences
          .replace(/\x1b[NOcZ78=>]/g, '')          // Single-character escape sequences
          .replace(/\x1b\([A-Z0-9]/g, '')          // Character set selection
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Control characters (except \t\n\r)
          .replace(/[\u2800-\u28FF]/g, '')         // Braille spinner characters
          .replace(/\[K/g, '')                     // Erase line (orphaned)
          .replace(/\[1G/g, '')                    // Move cursor (orphaned)
          .replace(/\[2K/g, '')                    // Clear line (orphaned)
          .replace(/\r\n/g, '\n')                  // Normalize line endings
          .replace(/\r/g, '');                     // Remove remaining carriage returns

        // Send if there's any content (including just newlines for formatting)
        if (cleanData.length > 0) {
          bus.send('claude-output', cleanData);
        }
    });

    state.ollamaProcess.onExit(({ exitCode }) => {
      state.ollamaProcess = null;
      bus.send('claude-done', exitCode);
      resolve(exitCode);
    });
  });
});

ipcMain.on('claude-stop', () => {
  if (state.ollamaProcess) {
    state.ollamaProcess.kill(); // node-pty kill() method
    state.ollamaProcess = null;
    bus.send('claude-done', -1);
  }
  // Also stop agent mode
  state.agentAborted = true;
});

// ============== Agent Mode with Tool Calling ==============

// Tool definitions for Ollama
const agentTools = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute a shell command and return the output. Use this for running any shell command like kubectl, git, npm, ls, cat, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to read'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to write'
          },
          content: {
            type: 'string',
            description: 'The content to write to the file'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories in a path',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The directory path to list'
          }
        },
        required: ['path']
      }
    }
  }
];

// Execute a tool and return the result
async function executeAgentTool(toolName, args, cwd) {
  try {
    switch (toolName) {
      case 'bash': {
        const { execSync } = require('child_process');
        try {
          const output = execSync(args.command, {
            cwd: cwd,
            encoding: 'utf-8',
            timeout: 60000,
            maxBuffer: 1024 * 1024 * 10
          });
          return output || '(command completed with no output)';
        } catch (e) {
          return `Error: ${e.message}\n${e.stderr || ''}`;
        }
      }
      case 'read_file': {
        const filePath = path.isAbsolute(args.path) ? args.path : path.join(cwd, args.path);
        if (!fs.existsSync(filePath)) {
          return `Error: File not found: ${filePath}`;
        }
        return fs.readFileSync(filePath, 'utf-8');
      }
      case 'write_file': {
        const filePath = path.isAbsolute(args.path) ? args.path : path.join(cwd, args.path);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, args.content, 'utf-8');
        return `File written: ${filePath}`;
      }
      case 'list_files': {
        const dirPath = path.isAbsolute(args.path) ? args.path : path.join(cwd, args.path);
        if (!fs.existsSync(dirPath)) {
          return `Error: Directory not found: ${dirPath}`;
        }
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        return items.map(item => `${item.isDirectory() ? '[dir] ' : ''}${item.name}`).join('\n');
      }
      default:
        return `Error: Unknown tool: ${toolName}`;
    }
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

// Agent execution using Ollama HTTP API with tool calling
ipcMain.handle('agent-execute', async (event, prompt, cwd) => {
  const ollamaModel = configStore.getOllamaModel();
  if (!ollamaModel) {
    bus.send('claude-error', 'No AI model selected. Select one from the AI menu.\n');
    bus.send('claude-done', 1);
    return 1;
  }

  state.agentAborted = false;
  const workingDir = cwd || process.env.HOME;

  // Check for /clear command to reset conversation
  if (prompt.trim().toLowerCase() === 'clear' || prompt.trim().toLowerCase() === '/clear') {
    state.agentConversationHistory = [];
    bus.send('claude-output', 'Conversation history cleared.\n');
    bus.send('claude-done', 0);
    return 0;
  }

  // Build messages array - include conversation history for context
  const systemMessage = {
    role: 'system',
    content: `You are a helpful assistant with access to tools. Use tools to help the user accomplish tasks. The current working directory is: ${workingDir}

When you need to run commands, read files, write files, or list directories, use the appropriate tool. After using tools, provide a summary of what you did. You have access to conversation history, so you can answer follow-up questions about previous results.`
  };

  // Start with system message, then history, then new prompt
  const messages = [systemMessage, ...state.agentConversationHistory, { role: 'user', content: prompt }];

  // Add user message to history
  state.agentConversationHistory.push({ role: 'user', content: prompt });

  try {
    let iterations = 0;
    const maxIterations = 20; // Prevent infinite loops

    while (iterations < maxIterations && !state.agentAborted) {
      iterations++;

      // Call Ollama API with tools
      const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel,
          messages: messages,
          tools: agentTools,
          stream: false
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        if (response.status === 400) {
          throw new Error(`Model "${ollamaModel}" may not support tool calling. Try llama3.2, llama3.1, mistral, or qwen2.5.\n\nDetails: ${errorBody}`);
        }
        throw new Error(`Ollama API error: ${response.status} - ${errorBody}`);
      }

      const result = await response.json();
      const assistantMessage = result.message;

      if (!assistantMessage) {
        throw new Error('No response from model');
      }

      // Add assistant message to history
      messages.push(assistantMessage);

      // Check if the model wants to call tools (native format)
      let toolCalls = assistantMessage.tool_calls || [];

      // Also check for JSON tool calls in text content (some models output this way)
      if (toolCalls.length === 0 && assistantMessage.content) {
        const jsonMatch = assistantMessage.content.match(/\{[\s\S]*"name"[\s\S]*"parameters"[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            // Map the JSON format to our tool format
            const toolName = parsed.name === 'Execute a shell command and return the output' ? 'bash' :
                            parsed.name === 'Read the contents of a file' ? 'read_file' :
                            parsed.name === 'Write content to a file' ? 'write_file' :
                            parsed.name === 'List files and directories in a path' ? 'list_files' :
                            parsed.name; // fallback to original name

            // Handle different parameter formats
            let toolArgs = parsed.parameters || parsed.arguments || {};
            if (toolArgs.command && Array.isArray(toolArgs.command)) {
              toolArgs = { command: toolArgs.command.join(' ') };
            }

            toolCalls = [{
              function: {
                name: toolName,
                arguments: toolArgs
              }
            }];
          } catch (e) {
            // Not valid JSON, treat as regular output
          }
        }
      }

      if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          if (state.agentAborted) break;

          const toolName = toolCall.function.name;
          const toolArgs = toolCall.function.arguments;

          // Show tool call in terminal
          bus.send('claude-output', `\n▶ ${toolName}: ${JSON.stringify(toolArgs)}\n`);

          // Execute the tool
          const toolResult = await executeAgentTool(toolName, toolArgs, workingDir);

          // Show result (truncated if too long)
          const displayResult = toolResult.length > 2000
            ? toolResult.substring(0, 2000) + '\n... (truncated)'
            : toolResult;
          bus.send('claude-output', `${displayResult}\n`);

          // Add tool result to messages (for current loop)
          messages.push({
            role: 'tool',
            content: toolResult
          });

          // Save tool call and result to conversation history
          state.agentConversationHistory.push({
            role: 'assistant',
            content: `[Used ${toolName}: ${JSON.stringify(toolArgs)}]\n\nResult:\n${toolResult.substring(0, 1000)}${toolResult.length > 1000 ? '...' : ''}`
          });
        }
      } else {
        // No tool calls - model is done, show final response
        if (assistantMessage.content) {
          bus.send('claude-output', assistantMessage.content);
          // Save final response to conversation history
          state.agentConversationHistory.push({
            role: 'assistant',
            content: assistantMessage.content
          });
        }
        break;
      }
    }

    if (iterations >= maxIterations) {
      bus.send('claude-output', '\n(Reached maximum iterations)\n');
    }

    // Limit conversation history to last 20 messages to prevent context overflow
    if (state.agentConversationHistory.length > 20) {
      state.agentConversationHistory = state.agentConversationHistory.slice(-20);
    }

    bus.send('claude-done', 0);
    return 0;
  } catch (e) {
    bus.send('claude-error', `Agent error: ${e.message}\n`);
    bus.send('claude-done', 1);
    return 1;
  }
});


ipcMain.handle('get-ai-provider', () => {
  return {
    provider: configStore.getAIProvider(),
    model: configStore.getOllamaModel()
  };
});

// File operations for pseudonymization
ipcMain.handle('read-file', async (event, filePath) => {
  return fs.readFileSync(filePath, 'utf-8');
});

ipcMain.handle('write-file', async (event, filePath, content) => {
  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
});

ipcMain.handle('create-directory', async (event, dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return true;
});

// Register menu module with dependencies
menuModule.register({
  state,
  bus,
  configStore,
  actions: {
    loadFile,
    createNewEditorWindow,
    newFile,
    newPresentation,
    openFile,
    openFolder,
    saveFile,
    saveFileAs,
    exportToPDF,
    sendFormatCommand,
    startPresentation,
    startPresentationWithPresenter,
    endPresentation,
    setTheme,
    showHelp,
  }
});

// App lifecycle
app.whenReady().then(() => {
  detectAITools(); // Detect available AI tools before creating menu
  createMenu();
  createMainWindow();

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
      loadFile(targetPath);
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
          loadFile(lastFile);
        }
      });
    } else if (lastFile && fs.existsSync(lastFile)) {
      loadFile(lastFile);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
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
    loadFile(filePath);
  } else {
    app.whenReady().then(() => {
      loadFile(filePath);
    });
  }
});

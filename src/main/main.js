const { app, BrowserWindow, Menu, dialog, ipcMain, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const pty = require('node-pty');
const Store = require('electron-store');

// Set app name for About dialog
app.setName('Vomit');

const store = new Store({
  defaults: {
    theme: 'default',
    lastOpenedFile: null,
    autoSaveEnabled: true,
    recentFiles: [],
    ollamaModel: 'llama3.2' // default Ollama model
  }
});

const MAX_RECENT_FILES = 10;

function addToRecentFiles(filePath) {
  if (!filePath) return;

  let recent = store.get('recentFiles') || [];
  // Remove if already exists
  recent = recent.filter(f => f !== filePath);
  // Add to front
  recent.unshift(filePath);
  // Limit to max
  recent = recent.slice(0, MAX_RECENT_FILES);
  store.set('recentFiles', recent);

  // Rebuild menu to update Recent Files
  createMenu();
}

let mainWindow = null;
let currentTheme = store.get('theme');
let autoSaveEnabled = store.get('autoSaveEnabled');
let presentationWindow = null;
let presenterWindow = null;
let currentFilePath = null;
let currentContent = '';
let editorWindows = []; // Track all editor windows
let fileWatcher = null; // Watch for external file changes
let lastKnownMtime = null; // Track file modification time
let ollamaProcess = null; // Track running Ollama process

// Cache for available Ollama
let availableAITools = {
  ollama: null,
  ollamaModels: []
};

// Find executable path (works on both Apple Silicon and Intel Macs)
function findExecutable(name) {
  const { execSync } = require('child_process');
  try {
    const result = execSync(`which ${name}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
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
  availableAITools.ollama = findExecutable('ollama');
  availableAITools.ollamaModels = getOllamaModels(availableAITools.ollama);

  return availableAITools;
}

// Build AI submenu dynamically based on available Ollama models
function buildAISubmenu() {
  const submenu = [
    {
      label: 'Toggle AI Terminal',
      accelerator: 'Ctrl+`',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('toggle-terminal');
        }
      }
    },
    { type: 'separator' }
  ];

  // Add Ollama models if available
  if (availableAITools.ollamaModels.length > 0) {
    for (const model of availableAITools.ollamaModels) {
      submenu.push({
        label: model,
        type: 'radio',
        checked: store.get('ollamaModel') === model,
        click: () => setOllamaModel(model)
      });
    }
  } else if (availableAITools.ollama) {
    submenu.push({
      label: 'No models installed',
      enabled: false
    });
    submenu.push({
      label: 'Run: ollama pull llama3.2',
      enabled: false
    });
  } else {
    submenu.push({
      label: 'Ollama not installed',
      enabled: false
    });
    submenu.push({
      label: 'Install from https://ollama.ai',
      enabled: false
    });
  }

  return submenu;
}

// Set Ollama model and show terminal
function setOllamaModel(model) {
  store.set('ollamaModel', model);
  createMenu();

  // Notify renderer and show terminal
  if (mainWindow) {
    mainWindow.webContents.send('ai-provider-changed', { provider: 'ollama', model });
    mainWindow.webContents.send('show-terminal');
  }
}

function createMainWindow() {
  const iconPath = path.join(__dirname, '../icon.png');

  // Set dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(iconPath);
  }

  mainWindow = new BrowserWindow({
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

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Warning for unsaved untitled files
  mainWindow.on('close', async (e) => {
    if (!currentFilePath && currentContent && currentContent.trim()) {
      e.preventDefault();
      const result = await dialog.showMessageBox(mainWindow, {
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
        mainWindow.destroy();
      } else if (result.response === 1) {
        // Don't Save
        mainWindow.destroy();
      }
      // Cancel: do nothing, window stays open
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (presentationWindow) presentationWindow.close();
    if (presenterWindow) presenterWindow.close();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    // Apply saved theme
    mainWindow.webContents.send('set-theme', currentTheme);

    if (currentFilePath && currentContent) {
      const basePath = path.dirname(currentFilePath);
      mainWindow.webContents.send('load-content', currentContent, currentFilePath, basePath);
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
    newWindow.webContents.send('set-theme', currentTheme);
  });

  newWindow.on('closed', () => {
    editorWindows = editorWindows.filter(w => w !== newWindow);
  });

  editorWindows.push(newWindow);
  return newWindow;
}

function createPresentationWindow() {
  presentationWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    title: 'Presentation',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#1e1e1e'
  });

  presentationWindow.loadFile(path.join(__dirname, '../renderer/presentation.html'));

  presentationWindow.on('closed', () => {
    presentationWindow = null;
  });

  return presentationWindow;
}

function createPresenterWindow() {
  presenterWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    title: 'Presenter View',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#2d2d2d'
  });

  presenterWindow.loadFile(path.join(__dirname, '../renderer/presenter.html'));

  presenterWindow.on('closed', () => {
    presenterWindow = null;
  });

  return presenterWindow;
}

function buildRecentFilesMenu() {
  const recentFiles = store.get('recentFiles') || [];

  if (recentFiles.length === 0) {
    return [{ label: 'No Recent Files', enabled: false }];
  }

  const items = recentFiles
    .filter(f => fs.existsSync(f)) // Only show files that still exist
    .map((filePath, index) => ({
      label: `${index + 1}. ${path.basename(filePath)}`,
      sublabel: filePath,
      click: () => loadFile(filePath)
    }));

  if (items.length === 0) {
    return [{ label: 'No Recent Files', enabled: false }];
  }

  // Add clear option
  items.push({ type: 'separator' });
  items.push({
    label: 'Clear Recent Files',
    click: () => {
      store.set('recentFiles', []);
      createMenu();
    }
  });

  return items;
}

function createMenu() {
  const template = [
    {
      label: 'Vomit',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('new-tab');
            }
          }
        },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createNewEditorWindow()
        },
        {
          label: 'New File',
          accelerator: 'CmdOrCtrl+N',
          click: () => newFile()
        },
        {
          label: 'New Presentation',
          accelerator: 'CmdOrCtrl+Alt+N',
          click: () => newPresentation()
        },
        { type: 'separator' },
        {
          label: 'Open File...',
          accelerator: 'CmdOrCtrl+O',
          click: () => openFile()
        },
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+Alt+O',
          click: () => openFolder()
        },
        {
          label: 'Open Recent',
          submenu: buildRecentFilesMenu()
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('close-tab');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => saveFile()
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => saveFileAs()
        },
        { type: 'separator' },
        {
          label: 'Export to PDF...',
          accelerator: 'CmdOrCtrl+E',
          click: () => exportToPDF()
        },
        { type: 'separator' },
        {
          label: 'Auto Save',
          type: 'checkbox',
          checked: autoSaveEnabled,
          click: (menuItem) => {
            autoSaveEnabled = menuItem.checked;
            store.set('autoSaveEnabled', autoSaveEnabled);
            if (mainWindow) {
              mainWindow.webContents.send('auto-save-changed', autoSaveEnabled);
            }
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Format',
      submenu: [
        {
          label: 'Bold',
          accelerator: 'CmdOrCtrl+B',
          click: () => sendFormatCommand('bold')
        },
        {
          label: 'Italic',
          accelerator: 'CmdOrCtrl+I',
          click: () => sendFormatCommand('italic')
        },
        {
          label: 'Code',
          accelerator: 'CmdOrCtrl+`',
          click: () => sendFormatCommand('code')
        },
        {
          label: 'Link',
          accelerator: 'CmdOrCtrl+K',
          click: () => sendFormatCommand('link')
        },
        {
          label: 'Table',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => sendFormatCommand('table')
        },
        { type: 'separator' },
        {
          label: 'Heading 1',
          accelerator: 'CmdOrCtrl+Shift+1',
          click: () => sendFormatCommand('h1')
        },
        {
          label: 'Heading 2',
          accelerator: 'CmdOrCtrl+Shift+2',
          click: () => sendFormatCommand('h2')
        },
        {
          label: 'Heading 3',
          accelerator: 'CmdOrCtrl+Shift+3',
          click: () => sendFormatCommand('h3')
        },
        { type: 'separator' },
        {
          label: 'Bullet List',
          accelerator: 'CmdOrCtrl+Shift+8',
          click: () => sendFormatCommand('bullet')
        },
        {
          label: 'Numbered List',
          accelerator: 'CmdOrCtrl+Shift+9',
          click: () => sendFormatCommand('numbered')
        },
        {
          label: 'Quote',
          accelerator: "CmdOrCtrl+'",
          click: () => sendFormatCommand('quote')
        },
        {
          label: 'Horizontal Rule',
          accelerator: 'CmdOrCtrl+-',
          click: () => sendFormatCommand('hr')
        },
        { type: 'separator' },
        {
          label: 'Insert Slide',
          accelerator: 'CmdOrCtrl+Enter',
          click: () => sendFormatCommand('slide')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Palette...',
          accelerator: 'CmdOrCtrl+.',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('show-command-palette');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle Preview',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('toggle-preview');
            }
          }
        },
        {
          label: 'Toggle Outline',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('toggle-outline');
            }
          }
        },
        {
          label: 'Toggle Files',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('toggle-files');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Find in File',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('find-in-file');
            }
          }
        },
        {
          label: 'Find and Replace',
          accelerator: 'CmdOrCtrl+Alt+F',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('find-and-replace');
            }
          }
        },
        {
          label: 'Search in Files',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('toggle-search');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle Line Numbers',
          accelerator: 'CmdOrCtrl+L',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('toggle-line-numbers');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Go to Parent Folder',
          accelerator: 'CmdOrCtrl+Up',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('navigate-parent');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Next Tab',
          accelerator: 'CmdOrCtrl+Shift+]',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('next-tab');
            }
          }
        },
        {
          label: 'Previous Tab',
          accelerator: 'CmdOrCtrl+Shift+[',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('prev-tab');
            }
          }
        },
        { type: 'separator' },
        ...[1,2,3,4,5,6,7,8].map(n => ({
          label: `Go to Tab ${n}`,
          accelerator: `CmdOrCtrl+${n}`,
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('go-to-tab', n);
            }
          }
        })),
        {
          label: 'Go to Last Tab',
          accelerator: 'CmdOrCtrl+9',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('go-to-tab', 9);
            }
          }
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Presentation',
      submenu: [
        {
          label: 'Start Presentation',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => startPresentation()
        },
        {
          label: 'Start with Presenter View',
          accelerator: 'CmdOrCtrl+Alt+P',
          click: () => startPresentationWithPresenter()
        },
        { type: 'separator' },
        {
          label: 'End Presentation',
          accelerator: 'Escape',
          click: () => endPresentation()
        }
      ]
    },
    {
      label: 'Theme',
      submenu: [
        { label: 'Default', click: () => setTheme('default') },
        { label: 'Dark', click: () => setTheme('dark') },
        { label: 'Catppuccin', click: () => setTheme('catppuccin') },
        { label: 'Nord', click: () => setTheme('nord') },
        { label: 'Tokyo Night', click: () => setTheme('tokyo-night') },
        { label: 'Solarized Dark', click: () => setTheme('solarized') }
      ]
    },
    {
      label: 'AI',
      submenu: buildAISubmenu()
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('show-shortcuts');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Vomit on GitHub',
          click: () => showHelp()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function newFile() {
  currentFilePath = null;
  currentContent = '';
  if (mainWindow) {
    mainWindow.webContents.send('load-content', '', null);
    mainWindow.setTitle('Untitled - Vomit');
  }
}

async function newPresentation() {
  currentFilePath = null;
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
  currentContent = template;
  if (mainWindow) {
    mainWindow.webContents.send('load-content', template, null);
    mainWindow.setTitle('Untitled Presentation - Vomit');
  }
}

async function openFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
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
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Folder',
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    store.set('lastOpenedFolder', folderPath);
    mainWindow.webContents.send('open-folder', folderPath);
    mainWindow.setTitle(`${path.basename(folderPath)} - Vomit`);
  }
}

let watchedFilePath = null;

function stopFileWatcher() {
  if (watchedFilePath) {
    try {
      fs.unwatchFile(watchedFilePath);
    } catch (err) {
      // Ignore errors when unwatching
    }
    watchedFilePath = null;
  }
  lastKnownMtime = null;
}

function startFileWatcher(filePath) {
  // Don't restart if already watching this file
  if (watchedFilePath === filePath) {
    return;
  }

  stopFileWatcher();

  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  try {
    // Get initial modification time
    lastKnownMtime = fs.statSync(filePath).mtimeMs;
    watchedFilePath = filePath;

    // Use fs.watchFile (polling) instead of fs.watch - more reliable on macOS
    fs.watchFile(filePath, { interval: 1000 }, (curr, prev) => {
      // File was modified externally
      if (curr.mtimeMs !== lastKnownMtime && curr.mtimeMs !== prev.mtimeMs) {
        lastKnownMtime = curr.mtimeMs;

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file-changed-externally', filePath);
        }
      }
    });
  } catch (err) {
    // Ignore file watch errors
  }
}

function loadFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    currentFilePath = filePath;
    currentContent = content;

    // Save as last opened file and add to recent
    store.set('lastOpenedFile', filePath);
    addToRecentFiles(filePath);

    // Start watching for external changes
    startFileWatcher(filePath);

    if (mainWindow) {
      const basePath = path.dirname(filePath);
      mainWindow.webContents.send('load-content', content, filePath, basePath);
      mainWindow.setTitle(`${path.basename(filePath)} - Vomit`);
    }
  } catch (err) {
    dialog.showErrorBox('Error', `Failed to open file: ${err.message}`);
  }
}

async function saveFile() {
  if (!currentFilePath) {
    return saveFileAs();
  }

  mainWindow.webContents.send('request-content');
}

async function saveFileAs() {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Markdown File',
    filters: [
      { name: 'Markdown Files', extensions: ['md'] }
    ],
    defaultPath: currentFilePath || 'untitled.md'
  });

  if (!result.canceled && result.filePath) {
    currentFilePath = result.filePath;
    mainWindow.webContents.send('request-content');
  }
}

function writeFile(content) {
  if (!currentFilePath) return;

  try {
    // Check if file was modified externally before saving
    if (fs.existsSync(currentFilePath) && lastKnownMtime) {
      const currentMtime = fs.statSync(currentFilePath).mtimeMs;
      if (currentMtime !== lastKnownMtime) {
        // File changed externally - notify renderer instead of overwriting
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file-changed-externally', currentFilePath);
        }
        return; // Don't overwrite
      }
    }

    fs.writeFileSync(currentFilePath, content, 'utf-8');
    currentContent = content;

    // Update mtime to avoid detecting our own save as external change
    lastKnownMtime = fs.statSync(currentFilePath).mtimeMs;

    if (mainWindow) {
      mainWindow.setTitle(`${path.basename(currentFilePath)} - Vomit`);
    }
  } catch (err) {
    dialog.showErrorBox('Error', `Failed to save file: ${err.message}`);
  }
}

function startPresentation() {
  if (!presentationWindow) {
    createPresentationWindow();
  }

  const basePath = currentFilePath ? path.dirname(currentFilePath) : null;

  presentationWindow.webContents.on('did-finish-load', () => {
    presentationWindow.webContents.send('load-presentation', currentContent, basePath);
    presentationWindow.setFullScreen(true);
  });

  if (presentationWindow.webContents.isLoading()) {
    // Will be handled by the did-finish-load event
  } else {
    presentationWindow.webContents.send('load-presentation', currentContent, basePath);
    presentationWindow.setFullScreen(true);
  }

  presentationWindow.focus();
}

function startPresentationWithPresenter() {
  if (!presentationWindow) {
    createPresentationWindow();
  }
  if (!presenterWindow) {
    createPresenterWindow();
  }

  const basePath = currentFilePath ? path.dirname(currentFilePath) : null;

  const loadContent = () => {
    if (presentationWindow) {
      presentationWindow.webContents.send('load-presentation', currentContent, basePath);
    }
    if (presenterWindow) {
      presenterWindow.webContents.send('load-presentation', currentContent, basePath);
    }
  };

  let loadedCount = 0;
  const checkLoaded = () => {
    loadedCount++;
    if (loadedCount >= 2) {
      loadContent();
    }
  };

  if (!presentationWindow.webContents.isLoading()) {
    checkLoaded();
  } else {
    presentationWindow.webContents.once('did-finish-load', checkLoaded);
  }

  if (!presenterWindow.webContents.isLoading()) {
    checkLoaded();
  } else {
    presenterWindow.webContents.once('did-finish-load', checkLoaded);
  }

  presentationWindow.focus();
}

function endPresentation() {
  if (presentationWindow) {
    presentationWindow.setFullScreen(false);
    presentationWindow.close();
  }
  if (presenterWindow) {
    presenterWindow.close();
  }
}

function sendFormatCommand(command) {
  if (mainWindow) {
    mainWindow.webContents.send('format-command', command);
  }
}

async function exportToPDF() {
  if (!currentContent) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'No Content',
      message: 'Nothing to export. Please open or create a presentation first.'
    });
    return;
  }

  // Ask where to save
  const defaultName = currentFilePath
    ? path.basename(currentFilePath, '.md') + '.pdf'
    : 'presentation.pdf';

  const result = await dialog.showSaveDialog(mainWindow, {
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

  const basePath = currentFilePath ? path.dirname(currentFilePath) : null;

  pdfWindow.webContents.on('did-finish-load', async () => {
    // Send content to render
    pdfWindow.webContents.send('render-for-pdf', currentContent, basePath);

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

      dialog.showMessageBox(mainWindow, {
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
  currentTheme = theme;
  store.set('theme', theme);

  if (mainWindow) {
    mainWindow.webContents.send('set-theme', theme);
  }
  if (presentationWindow) {
    presentationWindow.webContents.send('set-theme', theme);
  }
  if (presenterWindow) {
    presenterWindow.webContents.send('set-theme', theme);
  }
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
  currentContent = content;
  // Sync to presentation windows if open
  if (presentationWindow) {
    presentationWindow.webContents.send('update-content', content);
  }
  if (presenterWindow) {
    presenterWindow.webContents.send('update-content', content);
  }
});

// Update file watcher when active file changes (e.g., tab switch)
ipcMain.on('watch-file', (event, filePath) => {
  startFileWatcher(filePath);
});

// Get auto-save state
ipcMain.handle('get-auto-save-enabled', () => {
  return autoSaveEnabled;
});

// Get recent files
ipcMain.handle('get-recent-files', () => {
  const recentFiles = store.get('recentFiles') || [];
  return recentFiles
    .filter(f => fs.existsSync(f))
    .map(f => ({ path: f, name: path.basename(f) }));
});

// Check if there's a last session to restore
ipcMain.handle('has-last-session', () => {
  const lastFolder = store.get('lastOpenedFolder');
  const lastFile = store.get('lastOpenedFile');
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
  const pathToReload = filePath || currentFilePath;
  if (!pathToReload || !fs.existsSync(pathToReload)) {
    return { success: false, error: 'File not found' };
  }

  try {
    const content = fs.readFileSync(pathToReload, 'utf-8');
    lastKnownMtime = fs.statSync(pathToReload).mtimeMs;
    if (pathToReload === currentFilePath) {
      currentContent = content;
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
  if (presentationWindow && !presentationWindow.isDestroyed()) {
    presentationWindow.webContents.send('navigate-slide', direction);
  }
  if (presenterWindow && !presenterWindow.isDestroyed()) {
    presenterWindow.webContents.send('navigate-slide', direction);
  }
});

ipcMain.on('go-to-slide', (event, index) => {
  if (presentationWindow && !presentationWindow.isDestroyed()) {
    presentationWindow.webContents.send('go-to-slide', index);
  }
  if (presenterWindow && !presenterWindow.isDestroyed()) {
    presenterWindow.webContents.send('go-to-slide', index);
  }
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
  if (currentFilePath) {
    return path.dirname(currentFilePath);
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
    if (currentFilePath === oldPath) {
      currentFilePath = newPath;
      mainWindow.setTitle(`${path.basename(newPath)} - Vomit`);
    }

    return { success: true, newPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Delete file or folder
ipcMain.handle('delete-item', async (event, itemPath) => {
  try {
    const result = await dialog.showMessageBox(mainWindow, {
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
    if (currentFilePath) {
      imagesDir = path.join(path.dirname(currentFilePath), 'images');
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
    if (currentFilePath) {
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
  const result = await dialog.showMessageBox(mainWindow, {
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
    mainWindow.webContents.send('request-content');
    // The save will happen, resolve after a short delay
    setTimeout(resolve, 200);
  });
});

// Ollama execution using node-pty for proper TTY support
ipcMain.handle('claude-execute', async (event, command, cwd) => {
  const ollamaModel = store.get('ollamaModel');


  return new Promise((resolve, reject) => {
    // Kill any existing process
    if (ollamaProcess) {
      ollamaProcess.kill();
      ollamaProcess = null;
    }

    const execPath = availableAITools.ollama;
    if (!execPath) {
      mainWindow.webContents.send('claude-error', 'Ollama is not installed. Install it from https://ollama.ai\n');
      mainWindow.webContents.send('claude-done', 1);
      resolve(1);
      return;
    }
    if (availableAITools.ollamaModels.length === 0) {
      mainWindow.webContents.send('claude-error', `No Ollama models found. Run: ollama pull ${ollamaModel}\n`);
      mainWindow.webContents.send('claude-done', 1);
      resolve(1);
      return;
    }

    const args = ['run', ollamaModel, command];

    // Spawn Ollama with PTY for proper terminal emulation
    ollamaProcess = pty.spawn(execPath, args, {
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      cwd: cwd,
      env: { ...process.env }
    });

    ollamaProcess.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Clean ANSI escape codes and spinner characters but preserve newlines and spaces
        let cleanData = data
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')  // ANSI escape codes
          .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '') // Extended ANSI codes
          .replace(/[\u2800-\u28FF]/g, '')          // Braille spinner characters
          .replace(/\[K/g, '')                      // Erase line
          .replace(/\[1G/g, '')                     // Move cursor
          .replace(/\[2K/g, '')                     // Clear line
          .replace(/\r\n/g, '\n')                   // Normalize line endings
          .replace(/\r/g, '');                      // Remove remaining carriage returns

        // Send if there's any content (including just newlines for formatting)
        if (cleanData.length > 0) {
          mainWindow.webContents.send('claude-output', cleanData);
        }
      }
    });

    ollamaProcess.onExit(({ exitCode }) => {
      ollamaProcess = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('claude-done', exitCode);
      }
      resolve(exitCode);
    });
  });
});

ipcMain.on('claude-stop', () => {
  if (ollamaProcess) {
    ollamaProcess.kill(); // node-pty kill() method
    ollamaProcess = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('claude-done', -1);
    }
  }
});

ipcMain.handle('get-ai-provider', () => {
  return {
    provider: store.get('aiProvider'),
    model: store.get('ollamaModel')
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
      store.set('lastOpenedFolder', targetPath);
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('open-folder', targetPath);
        mainWindow.setTitle(`${path.basename(targetPath)} - Vomit`);
      });
    } else {
      // Open file
      loadFile(targetPath);
    }
  } else {
    // Try to restore last session (folder first, then file)
    const lastFolder = store.get('lastOpenedFolder');
    const lastFile = store.get('lastOpenedFile');

    if (lastFolder && fs.existsSync(lastFolder)) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('open-folder', lastFolder);
        mainWindow.setTitle(`${path.basename(lastFolder)} - Vomit`);
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
  if (mainWindow) {
    loadFile(filePath);
  } else {
    app.whenReady().then(() => {
      loadFile(filePath);
    });
  }
});

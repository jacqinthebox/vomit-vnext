const { app, BrowserWindow, Menu, dialog, ipcMain, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

// Set app name for About dialog
app.setName('Vomit');

const store = new Store({
  defaults: {
    theme: 'default',
    lastOpenedFile: null
  }
});

let mainWindow = null;
let currentTheme = store.get('theme');
let presentationWindow = null;
let presenterWindow = null;
let currentFilePath = null;
let currentContent = '';

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
    trafficLightPosition: { x: 15, y: 15 }
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
      mainWindow.webContents.send('load-content', currentContent, currentFilePath);
    }
  });
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
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => newFile()
        },
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
        { role: 'close' }
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
        { type: 'separator' },
        {
          label: 'Heading 1',
          accelerator: 'CmdOrCtrl+1',
          click: () => sendFormatCommand('h1')
        },
        {
          label: 'Heading 2',
          accelerator: 'CmdOrCtrl+2',
          click: () => sendFormatCommand('h2')
        },
        {
          label: 'Heading 3',
          accelerator: 'CmdOrCtrl+3',
          click: () => sendFormatCommand('h3')
        },
        { type: 'separator' },
        {
          label: 'Bullet List',
          accelerator: 'CmdOrCtrl+L',
          click: () => sendFormatCommand('bullet')
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
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('toggle-files');
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
        { label: 'Solarized Dark', click: () => setTheme('solarized') }
      ]
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
          label: 'Vomit Help',
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

function loadFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    currentFilePath = filePath;
    currentContent = content;

    // Save as last opened file
    store.set('lastOpenedFile', filePath);

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
    fs.writeFileSync(currentFilePath, content, 'utf-8');
    currentContent = content;
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

// App lifecycle
app.whenReady().then(() => {
  createMenu();
  createMainWindow();

  // Handle file open from command line or Finder
  const args = process.argv.slice(2);
  if (args.length > 0 && fs.existsSync(args[0])) {
    loadFile(args[0]);
  } else {
    // Try to load last opened file
    const lastFile = store.get('lastOpenedFile');
    if (lastFile && fs.existsSync(lastFile)) {
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

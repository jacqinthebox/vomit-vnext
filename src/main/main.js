const { app, BrowserWindow, Menu, dialog, ipcMain, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

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
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: 'Vomit vNext',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

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
      label: 'Vomit vNext',
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
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => openFile()
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
          label: 'Keyboard Shortcuts',
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
    mainWindow.setTitle('Untitled - Vomit vNext');
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
      mainWindow.setTitle(`${path.basename(filePath)} - Vomit vNext`);
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
      mainWindow.setTitle(`${path.basename(currentFilePath)} - Vomit vNext`);
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
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Help',
    message: 'Vomit vNext Help',
    detail: `KEYBOARD SHORTCUTS

File:
  Cmd+N - New file
  Cmd+O - Open file
  Cmd+S - Save file
  Cmd+Shift+S - Save as
  Cmd+E - Export to PDF

Format:
  Cmd+B - Bold
  Cmd+I - Italic
  Cmd+\` - Inline code
  Cmd+K - Insert link
  Cmd+1 - Heading 1
  Cmd+2 - Heading 2
  Cmd+3 - Heading 3
  Cmd+L - Bullet list
  Cmd+' - Quote
  Cmd+- - Horizontal rule
  Cmd+Enter - Insert slide

View:
  Cmd+P - Toggle preview
  Cmd+Shift+O - Toggle outline

Presentation:
  Cmd+Shift+P - Start presentation
  Cmd+Alt+P - Start with presenter view

During Presentation:
  Right/Space/N - Next slide
  Left/P - Previous slide
  Home - First slide
  End - Last slide
  L - Toggle laser pointer
  R - Reset timer
  Escape - End presentation

SLIDE FORMAT

Use --- to separate slides:
  # Slide 1
  Content here
  ---
  # Slide 2
  More content

Use ??? for speaker notes:
  # Slide Title
  Content
  ???
  Speaker notes (only visible in presenter view)

IMAGES

Paste images directly (Cmd+V) - saved to images/ folder

Resize syntax:
  ![alt](image.png =400x)     - width 400px
  ![alt](image.png =x300)     - height 300px
  ![alt](image.png =400x300)  - both
`
  });
}

// IPC Handlers
ipcMain.on('save-content', (event, content) => {
  writeFile(content);
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

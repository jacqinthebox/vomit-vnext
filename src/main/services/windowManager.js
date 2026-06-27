// @ts-check
'use strict';

const { BrowserWindow, dialog, app, shell } = require('electron');
const path = require('path');

const mainDir = path.join(__dirname, '..');

/**
 * Stop a window's renderer from ever navigating away from the app. Any link
 * that would load a new URL is blocked; http(s) URLs are opened in the user's
 * default browser instead. Without this, clicking an external link in rendered
 * content (preview, terminal output) navigates the BrowserWindow and crashes
 * the editor.
 * @param {import('electron').WebContents} webContents
 */
function guardWindowNavigation(webContents) {
  webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

/**
 * Create window manager with all window creation functions.
 * @param {{ state: import('./sessionState').SessionState, bus: import('../ipc/rendererBus').RendererBus, getSaveFileAs: () => Promise<void> }} deps
 */
function createWindowManager({ state, bus, getSaveFileAs }) {

  function createMainWindow() {
    const iconPath = path.join(mainDir, '../icon.png');

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
        preload: path.join(mainDir, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        plugins: true
      },
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 10 }
    }));

    bus.getMainWindow().loadFile(path.join(mainDir, '../renderer/index.html'));

    // Defense-in-depth: the app only ever loads index.html, so any in-page
    // link click that tries to navigate the window is a mistake — it blanks /
    // crashes the renderer. Block all navigation; send external URLs to the
    // user's browser instead. Renderer features may also intercept clicks for
    // nicer UX, but this is the backstop that guarantees the app never leaves.
    guardWindowNavigation(bus.getMainWindow().webContents);

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
          await getSaveFileAs();
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
      if (bus.getTerminalWindow()) bus.getTerminalWindow().close();
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
    const iconPath = path.join(mainDir, '../icon.png');

    const newWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 600,
      minHeight: 400,
      title: 'Vomit',
      icon: iconPath,
      webPreferences: {
        preload: path.join(mainDir, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      },
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 10 }
    });

    newWindow.loadFile(path.join(mainDir, '../renderer/index.html'));
    guardWindowNavigation(newWindow.webContents);

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
        preload: path.join(mainDir, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      },
      backgroundColor: '#1e1e1e'
    }));

    bus.getPresentationWindow().loadFile(path.join(mainDir, '../renderer/presentation.html'));

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
        preload: path.join(mainDir, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      },
      backgroundColor: '#2d2d2d'
    }));

    bus.getPresenterWindow().loadFile(path.join(mainDir, '../renderer/presenter.html'));

    bus.getPresenterWindow().on('closed', () => {
      bus.setPresenterWindow(null);
    });

    return bus.getPresenterWindow();
  }

  function createDocumentationWindow(content) {
    // If already open, just focus and update content
    if (bus.getDocumentationWindow()) {
      bus.getDocumentationWindow().focus();
      bus.sendToDocumentation('load-documentation', content);
      return bus.getDocumentationWindow();
    }

    bus.setDocumentationWindow(new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Documentation',
      webPreferences: {
        preload: path.join(mainDir, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      },
      backgroundColor: '#1e1e1e'
    }));

    bus.getDocumentationWindow().loadFile(path.join(mainDir, '../renderer/documentation.html'));

    bus.getDocumentationWindow().webContents.on('did-finish-load', () => {
      // Apply current theme
      bus.sendToDocumentation('set-theme', state.currentTheme);
      // Load the documentation content
      bus.sendToDocumentation('load-documentation', content);
    });

    bus.getDocumentationWindow().on('closed', () => {
      bus.setDocumentationWindow(null);
    });

    return bus.getDocumentationWindow();
  }

  function createTerminalWindow() {
    bus.setTerminalWindow(new BrowserWindow({
      width: 900,
      height: 500,
      minWidth: 600,
      minHeight: 300,
      title: 'Terminal',
      webPreferences: {
        preload: path.join(mainDir, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      },
      backgroundColor: '#1e1e1e'
    }));

    bus.getTerminalWindow().loadFile(path.join(mainDir, '../renderer/terminal.html'));

    bus.getTerminalWindow().on('closed', () => {
      bus.setTerminalWindow(null);
      state.isTerminalDetached = false;
      // Notify the main renderer so it restores the in-window terminal panel
      // and the detach/reattach button — without this, closing the detached
      // window via the OS X button leaves main stuck in "detached" mode.
      bus.send('terminal-reattached');
    });

    return bus.getTerminalWindow();
  }

  return { createMainWindow, createNewEditorWindow, createPresentationWindow, createPresenterWindow, createDocumentationWindow, createTerminalWindow };
}

module.exports = { createWindowManager };

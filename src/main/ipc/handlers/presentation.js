// @ts-check
'use strict';

const { BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const mainDir = path.join(__dirname, '..', '..');
const DOCUMENT_PAGE_MARGIN_INCHES = 0.6;

/**
 * Create presentation service with presentation functions and IPC handlers.
 * @param {{ state: import('../../services/sessionState').SessionState, bus: import('../rendererBus').RendererBus, configStore: typeof import('../../services/configStore'), windowManager: ReturnType<import('../../services/windowManager').createWindowManager> }} deps
 */
function createPresentationService({ state, bus, configStore, windowManager }) {
  function startPresentation() {
    if (!bus.getPresentationWindow()) {
      windowManager.createPresentationWindow();
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
      windowManager.createPresentationWindow();
    }
    if (!bus.getPresenterWindow()) {
      windowManager.createPresenterWindow();
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

  function closePresentationWindows() {
    if (bus.getPresentationWindow()) {
      bus.getPresentationWindow().setFullScreen(false);
      bus.getPresentationWindow().close();
    }
    if (bus.getPresenterWindow()) {
      bus.getPresenterWindow().close();
    }
  }

  // Escape is a menu accelerator, so the presentation renderer never sees the
  // keypress. Route it through the renderer, which closes its image-zoom
  // overlay if one is open and calls back on 'end-presentation' otherwise.
  function endPresentation() {
    if (bus.getPresentationWindow()) {
      bus.sendToPresentation('presentation-escape');
      return;
    }
    closePresentationWindows();
  }

  function sendFormatCommand(command) {
    bus.send('format-command', command);
  }

  async function exportToPDF() {
    if (!state.currentContent) {
      dialog.showMessageBox(bus.getMainWindow(), {
        type: 'warning',
        title: 'No Content',
        message: 'Nothing to export. Please open or create a presentation first.',
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
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    });

    if (result.canceled || !result.filePath) return;

    // Create hidden window for PDF rendering
    const pdfWindow = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      webPreferences: {
        preload: path.join(mainDir, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    pdfWindow.loadFile(path.join(mainDir, '../renderer/pdf-export.html'));

    const basePath = state.currentFilePath ? path.dirname(state.currentFilePath) : null;

    pdfWindow.webContents.on('did-finish-load', async () => {
      // Send content to render
      pdfWindow.webContents.send('render-for-pdf', state.currentContent, basePath);

      try {
        const isDocumentExport = await pdfWindow.webContents.executeJavaScript(`
          new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('PDF rendering timed out')),
              15000
            );
            const waitUntilReady = () => {
              if (window.pdfReady) {
                clearTimeout(timeout);
                resolve(window.pdfIsDocumentExport);
                return;
              }
              requestAnimationFrame(waitUntilReady);
            };
            waitUntilReady();
          })
        `);

        const pdfData = await pdfWindow.webContents.printToPDF({
          printBackground: true,
          landscape: !isDocumentExport,
          pageSize: 'A4',
          margins: isDocumentExport
            ? {
                top: DOCUMENT_PAGE_MARGIN_INCHES,
                bottom: DOCUMENT_PAGE_MARGIN_INCHES,
                left: 0,
                right: 0,
              }
            : { top: 0, bottom: 0, left: 0, right: 0 },
        });

        await fs.promises.writeFile(result.filePath, pdfData);

        const { response } = await dialog.showMessageBox(bus.getMainWindow(), {
          type: 'info',
          title: 'Export Complete',
          message: `PDF exported successfully to:\n${result.filePath}`,
          buttons: ['Open PDF', 'Close'],
          defaultId: 0,
          cancelId: 1,
        });

        if (response === 0) {
          const openError = await shell.openPath(result.filePath);
          if (openError) {
            dialog.showErrorBox('Open Failed', `Failed to open PDF: ${openError}`);
          }
        }
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

  /**
   * Register presentation-related IPC handlers.
   * @param {import('electron').IpcMain} ipcMain
   */
  function registerHandlers(ipcMain) {
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

    // Callback from the presentation renderer's escape routing (see
    // endPresentation above).
    ipcMain.on('end-presentation', () => {
      closePresentationWindows();
    });

    // Command palette IPC handlers
    ipcMain.on('export-to-pdf', () => {
      exportToPDF();
    });

    ipcMain.on('palette-set-theme', (event, theme) => {
      setTheme(theme);
    });

    ipcMain.on('show-help', () => {
      showHelp();
    });
  }

  return {
    startPresentation,
    startPresentationWithPresenter,
    endPresentation,
    sendFormatCommand,
    exportToPDF,
    setTheme,
    showHelp,
    registerHandlers,
  };
}

module.exports = { createPresentationService };

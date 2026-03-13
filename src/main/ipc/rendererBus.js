// @ts-check
'use strict';

/**
 * RendererBus — centralized main→renderer communication.
 * All domains call bus.send() instead of mainWindow.webContents.send() directly.
 */
class RendererBus {
  constructor() {
    /** @type {import('electron').BrowserWindow|null} */
    this._mainWindow = null;
    /** @type {import('electron').BrowserWindow|null} */
    this._presentationWindow = null;
    /** @type {import('electron').BrowserWindow|null} */
    this._presenterWindow = null;
    /** @type {import('electron').BrowserWindow[]} */
    this._editorWindows = [];
    /** @type {import('electron').BrowserWindow|null} */
    this._documentationWindow = null;
  }

  /** @param {import('electron').BrowserWindow|null} win */
  setMainWindow(win) { this._mainWindow = win; }
  /** @returns {import('electron').BrowserWindow|null} */
  getMainWindow() { return this._mainWindow; }

  /** @param {import('electron').BrowserWindow|null} win */
  setPresentationWindow(win) { this._presentationWindow = win; }
  /** @returns {import('electron').BrowserWindow|null} */
  getPresentationWindow() { return this._presentationWindow; }

  /** @param {import('electron').BrowserWindow|null} win */
  setPresenterWindow(win) { this._presenterWindow = win; }
  /** @returns {import('electron').BrowserWindow|null} */
  getPresenterWindow() { return this._presenterWindow; }

  /** @returns {import('electron').BrowserWindow[]} */
  getEditorWindows() { return this._editorWindows; }

  /** @param {import('electron').BrowserWindow|null} win */
  setDocumentationWindow(win) { this._documentationWindow = win; }
  /** @returns {import('electron').BrowserWindow|null} */
  getDocumentationWindow() { return this._documentationWindow; }

  /**
   * Send a message to the main renderer window.
   * @param {string} channel
   * @param {...any} args
   */
  send(channel, ...args) {
    if (this._mainWindow?.webContents) {
      this._mainWindow.webContents.send(channel, ...args);
    }
  }

  /**
   * Send a message to the presentation window.
   * @param {string} channel
   * @param {...any} args
   */
  sendToPresentation(channel, ...args) {
    if (this._presentationWindow?.webContents) {
      this._presentationWindow.webContents.send(channel, ...args);
    }
  }

  /**
   * Send a message to the presenter window.
   * @param {string} channel
   * @param {...any} args
   */
  sendToPresenter(channel, ...args) {
    if (this._presenterWindow?.webContents) {
      this._presenterWindow.webContents.send(channel, ...args);
    }
  }

  /**
   * Send a message to the documentation window.
   * @param {string} channel
   * @param {...any} args
   */
  sendToDocumentation(channel, ...args) {
    if (this._documentationWindow?.webContents) {
      this._documentationWindow.webContents.send(channel, ...args);
    }
  }

  /**
   * Broadcast a message to all windows (main + presentation + presenter).
   * @param {string} channel
   * @param {...any} args
   */
  broadcast(channel, ...args) {
    this.send(channel, ...args);
    this.sendToPresentation(channel, ...args);
    this.sendToPresenter(channel, ...args);
  }
}

module.exports = { RendererBus };

// @ts-check
'use strict';

const { dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const wiki = require('../../wiki');

/**
 * Create bucket service with all bucket operations and IPC handlers.
 * @param {{ state: import('../../services/sessionState').SessionState, bus: import('../rendererBus').RendererBus, configStore: typeof import('../../services/configStore'), menuModule: { createMenu: () => void } }} deps
 */
function createBucketService({ state, bus, configStore, menuModule }) {

  /**
   * Switch to a bucket at the given index
   * @param {number} index
   * @returns {{ success: boolean, bucket?: import('../../services/configStore').Bucket, error?: string }}
   */
  function switchBucket(index) {
    const buckets = configStore.getBuckets();
    if (index < 0 || index >= buckets.length) {
      return { success: false, error: 'Invalid bucket index' };
    }

    const bucket = buckets[index];
    if (!fs.existsSync(bucket.path) || !fs.statSync(bucket.path).isDirectory()) {
      return { success: false, error: 'Bucket directory no longer exists' };
    }

    configStore.setActiveBucketIndex(index);
    state.currentProjectRoot = bucket.path;
    state.currentFilePath = null;

    bus.send('bucket-switched', bucket);
    bus.send('open-folder', bucket.path);
    bus.getMainWindow()?.setTitle(`${bucket.name} - Vomit`);

    menuModule.createMenu();

    // Rebuild the wiki index for the new bucket in the background.
    setTimeout(() => {
      wiki.indexBucket(bucket.path).then(() => {
        bus.send('wiki-changed', { type: 'reindex' });
        bus.sendToTerminal('wiki-changed', { type: 'reindex' });
      }).catch(() => {});
    }, 500);

    return { success: true, bucket };
  }

  /**
   * Add a new bucket via folder picker
   * @returns {Promise<{ success: boolean, bucket?: import('../../services/configStore').Bucket, index?: number, cancelled?: boolean, error?: string }>}
   */
  async function addBucket() {
    const mainWindow = bus.getMainWindow();

    const folderResult = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Bucket Location',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: path.join(os.homedir(), 'Documents')
    });

    if (folderResult.canceled || folderResult.filePaths.length === 0) {
      return { success: false, cancelled: true };
    }

    const chosenPath = folderResult.filePaths[0];

    // Check if bucket already exists
    const buckets = configStore.getBuckets();
    const existingIndex = buckets.findIndex(b => b.path === chosenPath);
    if (existingIndex !== -1) {
      // Switch to existing bucket instead of adding duplicate
      return switchBucket(existingIndex);
    }

    // Create directory if needed
    if (!fs.existsSync(chosenPath)) {
      fs.mkdirSync(chosenPath, { recursive: true });
    }

    // Create images subfolder
    const imagesDir = path.join(chosenPath, 'images');
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    const bucket = {
      name: path.basename(chosenPath),
      path: chosenPath
    };

    const index = configStore.addBucket(bucket);
    menuModule.createMenu();

    // Switch to the new bucket
    switchBucket(index);

    return { success: true, bucket, index };
  }

  /**
   * Remove a bucket at the given index
   * @param {number} index
   * @returns {Promise<{ success: boolean, cancelled?: boolean, error?: string }>}
   */
  async function removeBucket(index) {
    const buckets = configStore.getBuckets();
    if (index < 0 || index >= buckets.length) {
      return { success: false, error: 'Invalid bucket index' };
    }

    const bucket = buckets[index];
    const mainWindow = bus.getMainWindow();

    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Remove', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Remove Bucket',
      message: `Remove "${bucket.name}" from Vomit?`,
      detail: 'This only removes the bucket from Vomit. Your files will not be deleted.'
    });

    if (result.response === 1) {
      return { success: false, cancelled: true };
    }

    const wasActive = configStore.getActiveBucketIndex() === index;
    configStore.removeBucket(index);
    menuModule.createMenu();

    // If removed the active bucket, switch to first remaining bucket
    if (wasActive) {
      const remainingBuckets = configStore.getBuckets();
      if (remainingBuckets.length > 0) {
        switchBucket(0);
      } else {
        // No buckets left - clear state (app will show setup on next launch)
        state.currentProjectRoot = null;
        state.currentFilePath = null;
        bus.send('bucket-switched', null);
      }
    }

    return { success: true };
  }

  /**
   * Register IPC handlers for bucket operations
   * @param {import('electron').IpcMain} ipcMain
   */
  function registerHandlers(ipcMain) {
    ipcMain.handle('get-buckets', () => {
      return configStore.getBuckets();
    });

    ipcMain.handle('get-active-bucket', () => {
      return configStore.getActiveBucket();
    });

    ipcMain.handle('switch-bucket', (_event, index) => {
      return switchBucket(index);
    });

    ipcMain.handle('add-bucket', async () => {
      return await addBucket();
    });

    ipcMain.handle('remove-bucket', async (_event, index) => {
      return await removeBucket(index);
    });
  }

  return {
    switchBucket,
    addBucket,
    removeBucket,
    registerHandlers
  };
}

module.exports = { createBucketService };

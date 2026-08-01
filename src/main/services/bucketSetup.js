// @ts-check
'use strict';

const { dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DEFAULT_BUCKET_PATH = path.join(os.homedir(), 'Documents', 'Vomit');

/**
 * Check if bucket path exists and is a valid directory.
 * @param {string|null} bucketPath
 * @returns {boolean}
 */
function isBucketValid(bucketPath) {
  if (!bucketPath) return false;
  try {
    return fs.existsSync(bucketPath) && fs.statSync(bucketPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Show first-run bucket setup dialog.
 * @param {import('electron').BrowserWindow|null} parentWindow
 * @returns {Promise<string|null>} The chosen bucket path, or null if cancelled
 */
async function showBucketSetupDialog(parentWindow) {
  const welcomeResult = await dialog.showMessageBox(parentWindow, {
    type: 'info',
    buttons: ['Use Default Location', 'Choose Custom Location', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Welcome to Vomit',
    message: 'Choose where to store your notes',
    detail: `Vomit uses a single folder ("bucket") to store all your notes.\n\nDefault location:\n${DEFAULT_BUCKET_PATH}`,
  });

  if (welcomeResult.response === 2) {
    return null;
  }

  let chosenPath = DEFAULT_BUCKET_PATH;

  if (welcomeResult.response === 1) {
    const folderResult = await dialog.showOpenDialog(parentWindow, {
      title: 'Choose Bucket Location',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: path.join(os.homedir(), 'Documents'),
    });

    if (folderResult.canceled || folderResult.filePaths.length === 0) {
      return null;
    }

    chosenPath = folderResult.filePaths[0];
  }

  // Create bucket directory if it doesn't exist
  if (!fs.existsSync(chosenPath)) {
    fs.mkdirSync(chosenPath, { recursive: true });
  }

  // Create images subfolder
  const imagesDir = path.join(chosenPath, 'images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  return chosenPath;
}

module.exports = {
  DEFAULT_BUCKET_PATH,
  isBucketValid,
  showBucketSetupDialog,
};

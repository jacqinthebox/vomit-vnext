// @ts-check
'use strict';

const { dialog, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * Create file service with all file operations and IPC handlers.
 * @param {{ state: import('../../services/sessionState').SessionState, bus: import('../rendererBus').RendererBus, configStore: typeof import('../../services/configStore') }} deps
 */
function createFileService({ state, bus, configStore }) {

  async function newFile() {
    const bucketPath = configStore.getBucketPath();
    if (!bucketPath) {
      bus.send('load-content', '', null);
      bus.getMainWindow()?.setTitle('Untitled - Vomit');
      return;
    }

    // Use current directory if within bucket, otherwise bucket root
    let targetDir = bucketPath;
    if (state.currentFilePath && state.currentFilePath.startsWith(bucketPath)) {
      targetDir = path.dirname(state.currentFilePath);
    }

    // Generate unique filename: untitled-1.md, untitled-2.md, etc.
    let counter = 1;
    let filePath;
    do {
      filePath = path.join(targetDir, `untitled-${counter}.md`);
      counter++;
    } while (fs.existsSync(filePath));

    // Create the file immediately
    fs.writeFileSync(filePath, '', 'utf-8');

    // Load the new file
    loadFile(filePath);

    // Refresh file tree
    bus.send('refresh-file-tree');
  }

  async function newPresentation() {
    const bucketPath = configStore.getBucketPath();
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

    if (!bucketPath) {
      state.currentFilePath = null;
      state.currentContent = template;
      bus.send('load-content', template, null);
      bus.getMainWindow()?.setTitle('Untitled Presentation - Vomit');
      return;
    }

    // Use current directory if within bucket, otherwise bucket root
    let targetDir = bucketPath;
    if (state.currentFilePath && state.currentFilePath.startsWith(bucketPath)) {
      targetDir = path.dirname(state.currentFilePath);
    }

    // Generate unique filename
    let counter = 1;
    let filePath;
    do {
      filePath = path.join(targetDir, `presentation-${counter}.md`);
      counter++;
    } while (fs.existsSync(filePath));

    // Create the file immediately with template
    fs.writeFileSync(filePath, template, 'utf-8');

    // Load the new file
    loadFile(filePath);

    // Refresh file tree
    bus.send('refresh-file-tree');
  }

  async function openFile() {
    const bucketPath = configStore.getBucketPath();
    const result = await dialog.showOpenDialog(bus.getMainWindow(), {
      title: 'Open Markdown File',
      filters: [
        { name: 'Markdown Files', extensions: ['md', 'markdown'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile'],
      defaultPath: bucketPath || undefined
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      loadFile(filePath);
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
    const bucketPath = configStore.getBucketPath();
    let defaultPath = 'untitled.md';

    if (state.currentFilePath) {
      defaultPath = state.currentFilePath;
    } else if (bucketPath) {
      defaultPath = path.join(bucketPath, 'untitled.md');
    }

    const result = await dialog.showSaveDialog(bus.getMainWindow(), {
      title: 'Save Markdown File',
      filters: [
        { name: 'Markdown Files', extensions: ['md'] }
      ],
      defaultPath
    });

    if (!result.canceled && result.filePath) {
      // Validate file is within bucket if bucket is configured
      if (bucketPath && !result.filePath.startsWith(bucketPath)) {
        await dialog.showMessageBox(bus.getMainWindow(), {
          type: 'error',
          title: 'Error',
          message: 'Files must be saved within your bucket folder.',
          detail: `Bucket location: ${bucketPath}`
        });
        return;
      }

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

  /**
   * Register all file-related IPC handlers.
   * @param {import('electron').IpcMain} ipcMain
   */
  function registerHandlers(ipcMain) {
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

    // Get bucket path
    ipcMain.handle('get-bucket-path', () => {
      return configStore.getBucketPath();
    });

    // Command palette IPC handlers
    ipcMain.on('new-file', () => newFile());
    ipcMain.on('new-presentation', () => newPresentation());
    ipcMain.on('open-file-dialog', () => openFile());
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

    // Image handling - save to bucket/images
    ipcMain.handle('save-image', async (event, imageData, suggestedName) => {
      try {
        const bucketPath = configStore.getBucketPath();
        let imagesDir;

        if (bucketPath) {
          imagesDir = path.join(bucketPath, 'images');
        } else if (state.currentFilePath) {
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

        // Refresh file tree to show new image
        bus.send('refresh-file-tree');

        // Return relative path from bucket
        if (bucketPath) {
          return `images/${filename}`;
        }
        return filepath;
      } catch (err) {
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

    // File operations for pseudonymization
    ipcMain.handle('read-file', async (event, filePath) => {
      try {
        return fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        throw new Error(`Failed to read file: ${err.message}`);
      }
    });

    ipcMain.handle('write-file', async (event, filePath, content) => {
      try {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, 'utf-8');
        return true;
      } catch (err) {
        throw new Error(`Failed to write file: ${err.message}`);
      }
    });

    ipcMain.handle('create-directory', async (event, dirPath) => {
      try {
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        return true;
      } catch (err) {
        throw new Error(`Failed to create directory: ${err.message}`);
      }
    });
  }

  return {
    newFile, newPresentation, openFile,
    loadFile, saveFile, saveFileAs, writeFile,
    stopFileWatcher, startFileWatcher,
    registerHandlers
  };
}

module.exports = { createFileService };

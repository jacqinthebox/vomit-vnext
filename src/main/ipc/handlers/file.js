// @ts-check
'use strict';

const { dialog, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * Create file service with all file operations and IPC handlers.
 * @param {{ state: import('../../services/sessionState').SessionState, bus: import('../rendererBus').RendererBus, configStore: typeof import('../../services/configStore'), createMenu: () => void }} deps
 */
function createFileService({ state, bus, configStore, createMenu }) {

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
  }

  return {
    newFile, newPresentation, openFile, openFolder,
    loadFile, saveFile, saveFileAs, writeFile,
    stopFileWatcher, startFileWatcher,
    registerHandlers
  };
}

module.exports = { createFileService };

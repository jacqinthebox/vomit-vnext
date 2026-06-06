// @ts-check
'use strict';

const { dialog, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const os = require('os');
const { execFile } = require('child_process');
const chokidar = require('chokidar');
const wiki = require('../../wiki');

/**
 * Create file service with all file operations and IPC handlers.
 * @param {{ state: import('../../services/sessionState').SessionState, bus: import('../rendererBus').RendererBus, configStore: typeof import('../../services/configStore') }} deps
 */
function localDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isMarkdownPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.md' || ext === '.markdown';
}

function isSameOrSubPath(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function updateModifiedDate(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return content;

  const frontmatter = match[0];
  if (!/^modified:/m.test(match[1])) return content;

  const today = localDateString();
  const updated = frontmatter.replace(/^modified:.*$/m, `modified: ${today}`);
  return updated + content.substring(frontmatter.length);
}

const SKIP_RENAME_DIRS = new Set(['node_modules', 'pseudo', '.git', '.obsidian', 'pseudo']);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace every [[oldName]], [[oldName|alias]], [[oldName#heading]] occurrence
 * with the new basename across the bucket. Returns the number of files
 * modified. Matching is case-insensitive on the target name and preserves
 * the alias/heading suffix exactly.
 */
function updateWikilinkReferences(bucketRoot, oldBasename, newBasename) {
  if (!bucketRoot || !oldBasename || !newBasename) return 0;

  // [[oldName]] | [[oldName|alias]] | [[oldName#heading]] | [[oldName#h|alias]]
  const re = new RegExp(
    `\\[\\[(${escapeRegExp(oldBasename)})((?:#[^\\]|\\n]+)?(?:\\|[^\\]\\n]+)?)\\]\\]`,
    'gi'
  );

  let modified = 0;
  const walk = (dir) => {
    let items;
    try { items = fs.readdirSync(dir); } catch { return; }
    for (const item of items) {
      if (item.startsWith('.') || SKIP_RENAME_DIRS.has(item)) continue;
      const fullPath = path.join(dir, item);
      let stat;
      try { stat = fs.statSync(fullPath); } catch { continue; }
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!isMarkdownPath(fullPath)) continue;
      let content;
      try { content = fs.readFileSync(fullPath, 'utf-8'); } catch { continue; }
      if (!re.test(content)) continue;
      re.lastIndex = 0;
      const updated = content.replace(re, (_m, _name, suffix) => `[[${newBasename}${suffix || ''}]]`);
      if (updated !== content) {
        try {
          fs.writeFileSync(fullPath, updated, 'utf-8');
          modified++;
        } catch {}
      }
      re.lastIndex = 0;
    }
  };
  walk(bucketRoot);
  return modified;
}

function createFileService({ state, bus, configStore }) {

  async function newFile() {
    const bucketPath = configStore.getBucketPath();
    if (!bucketPath) {
      bus.send('load-content', '', null);
      bus.getMainWindow()?.setTitle('Untitled - Vomit');
      return;
    }

    // Determine target directory: current file's directory or bucket root
    let targetDir = bucketPath;
    if (state.currentFilePath && state.currentFilePath.startsWith(bucketPath)) {
      targetDir = path.dirname(state.currentFilePath);
    }

    // Send to renderer to show file tree with inline input
    bus.send('new-file-inline', targetDir);
  }

  const presentationTemplate = `---
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

  async function newPresentation() {
    const bucketPath = configStore.getBucketPath();

    if (!bucketPath) {
      state.currentFilePath = null;
      state.currentContent = presentationTemplate;
      bus.send('load-content', presentationTemplate, null);
      bus.getMainWindow()?.setTitle('Untitled Presentation - Vomit');
      return;
    }

    // Determine target directory: current file's directory or bucket root
    let targetDir = bucketPath;
    if (state.currentFilePath && state.currentFilePath.startsWith(bucketPath)) {
      targetDir = path.dirname(state.currentFilePath);
    }

    // Send to renderer to show file tree with inline input
    bus.send('new-presentation-inline', targetDir);
  }

  function createPresentationFile(filePath) {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, presentationTemplate, 'utf-8');
      loadFile(filePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function openFile() {
    const bucketPath = configStore.getBucketPath();
    const result = await dialog.showOpenDialog(bus.getMainWindow(), {
      title: 'Open File',
      filters: [
        { name: 'Markdown Files', extensions: ['md', 'markdown'] },
        { name: 'PDF Files', extensions: ['pdf'] },
        { name: 'Draw.io Diagrams', extensions: ['drawio'] },
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

  // Directory watcher for file tree auto-refresh
  let directoryWatcher = null;
  let watchedDirectory = null;
  const debounceMap = new Map(); // per-folder debounce timers; kept in outer scope for cleanup

  function stopDirectoryWatcher() {
    for (const timer of debounceMap.values()) clearTimeout(timer);
    debounceMap.clear();
    if (directoryWatcher) {
      try { directoryWatcher.close(); } catch (_) {}
      directoryWatcher = null;
      watchedDirectory = null;
    }
  }

  function startDirectoryWatcher(dirPath) {
    if (!dirPath || !fs.existsSync(dirPath)) return;
    if (watchedDirectory === dirPath) return;

    stopDirectoryWatcher();
    watchedDirectory = dirPath;

    directoryWatcher = chokidar.watch(dirPath, {
      // Ignore node_modules, .git dir, and hidden files — use segment-aware regex
      ignored: /(^|[/\\])(node_modules|\.git)(\/|\\|$)/,
      persistent: true,
      ignoreInitial: true
    });

    const sendRefresh = (eventName, eventPath) => {
      const changedDir = path.dirname(eventPath);
      if (debounceMap.has(changedDir)) clearTimeout(debounceMap.get(changedDir));
      debounceMap.set(changedDir, setTimeout(() => {
        debounceMap.delete(changedDir);
        const payload = { changedPath: changedDir };
        // For deleted dirs, also pass the path so renderer can purge its subtree cache
        if (eventName === 'unlinkDir') payload.deletedPath = eventPath;
        bus.send('refresh-file-tree', payload);
      }, 300));
    };

    directoryWatcher
      .on('add',       p => sendRefresh('add', p))
      .on('addDir',    p => sendRefresh('addDir', p))
      .on('unlink',    p => sendRefresh('unlink', p))
      .on('unlinkDir', p => sendRefresh('unlinkDir', p))
      .on('error',     () => stopDirectoryWatcher());
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

  function isViewerFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ['.pdf', '.drawio'].includes(ext);
  }

  function getDrawioCliPath() {
    const candidates = process.platform === 'win32'
      ? [
          path.join(process.env.ProgramFiles || '', 'draw.io', 'draw.io.exe'),
          path.join(process.env.ProgramFiles || '', 'diagrams.net', 'diagrams.net.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'draw.io', 'draw.io.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'diagrams.net', 'diagrams.net.exe')
        ]
      : [
          '/opt/homebrew/bin/drawio',
          '/usr/local/bin/drawio',
          '/Applications/draw.io.app/Contents/MacOS/draw.io',
          '/Applications/diagrams.net.app/Contents/MacOS/diagrams.net'
        ];
    return candidates.find(candidate => fs.existsSync(candidate)) || null;
  }

  function renderDrawioToSvg(filePath) {
    return new Promise((resolve, reject) => {
      const cliPath = getDrawioCliPath();
      if (!cliPath) {
        reject(new Error('draw.io CLI not found'));
        return;
      }

      const outputPath = path.join(os.tmpdir(), `vomit-drawio-${Date.now()}-${Math.random().toString(36).slice(2)}.svg`);
      const args = [
        '--export',
        '--format', 'svg',
        '--embed-svg-images',
        '--embed-svg-fonts', 'true',
        '--svg-theme', 'light',
        '--border', '8',
        '--output', outputPath,
        filePath
      ];

      execFile(cliPath, args, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || stdout || err.message));
          return;
        }

        try {
          const svg = fs.readFileSync(outputPath, 'utf-8');
          fs.unlink(outputPath, () => {});
          resolve(svg);
        } catch (readErr) {
          reject(readErr);
        }
      });
    });
  }

  function loadFile(filePath) {
    try {
      // For viewer files (PDF, draw.io), don't read as text — renderer handles loading
      const isViewer = isViewerFile(filePath);
      const content = isViewer ? '' : fs.readFileSync(filePath, 'utf-8');
      state.currentFilePath = filePath;
      state.currentContent = content;

      // Start watching for external changes
      startFileWatcher(filePath);

      // Start watching bucket directory for file tree auto-refresh
      const bucketPath = configStore.getBucketPath();
      if (bucketPath) {
        startDirectoryWatcher(bucketPath);
      }

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

      // Update modified date in frontmatter for markdown files
      if (isMarkdownPath(state.currentFilePath)) {
        content = updateModifiedDate(content);
      }

      fs.writeFileSync(state.currentFilePath, content, 'utf-8');
      state.currentContent = content;

      // Update mtime to avoid detecting our own save as external change
      state.lastKnownMtime = fs.statSync(state.currentFilePath).mtimeMs;

      // Live-index wikilinks for the active document.
      try {
        const bucketRoot = state.currentProjectRoot;
        if (bucketRoot && isMarkdownPath(state.currentFilePath) && state.currentFilePath.startsWith(bucketRoot)) {
          wiki.indexSingleFile(bucketRoot, state.currentFilePath);
          bus.send('wiki-changed', { type: 'file', path: state.currentFilePath });
          bus.sendToTerminal('wiki-changed', { type: 'file', path: state.currentFilePath });
        }
      } catch {}

      bus.getMainWindow()?.setTitle(`${path.basename(state.currentFilePath)} - Vomit`);
      bus.send('file-saved', { filePath: state.currentFilePath });
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
    ipcMain.on('set-current-file', (event, filePath, content) => {
      state.currentFilePath = filePath;
      if (typeof content === 'string') {
        state.currentContent = content;
        return;
      }
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

    // Get mermaid curve setting
    ipcMain.handle('get-mermaid-curve', () => {
      return configStore.getMermaidCurve();
    });

    // Get font size setting
    ipcMain.handle('get-font-size', () => {
      return configStore.getFontSize();
    });

    // Command palette IPC handlers
    ipcMain.on('new-file', () => newFile());
    ipcMain.on('new-presentation', () => newPresentation());
    ipcMain.on('open-file-dialog', () => openFile());
    ipcMain.on('save-as', () => saveFileAs());

    // Create presentation file with template
    ipcMain.handle('create-presentation-file', async (event, filePath) => {
      return createPresentationFile(filePath);
    });

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

    // Open file with system default application
    ipcMain.handle('open-with-default', async (event, filePath) => {
      if (filePath && fs.existsSync(filePath)) {
        await shell.openPath(filePath);
      }
    });

    // Get directory contents for file tree
    ipcMain.handle('get-directory-contents', async (event, dirPath) => {
      try {
        // Start watching bucket directory for auto-refresh
        const bucketPath = configStore.getBucketPath();
        if (bucketPath) {
          startDirectoryWatcher(bucketPath);
        }

        const sortOrder = configStore.getFileSortOrder();
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const items = entries
          .filter(entry => !entry.name.startsWith('.') && (configStore.getShowImagesFolder() || entry.name !== 'images')) // Hide hidden files; hide images folder unless toggled on
          .map(entry => {
            const fullPath = path.join(dirPath, entry.name);
            let mtimeMs = 0;
            try { mtimeMs = fs.statSync(fullPath).mtimeMs; } catch (e) {}
            return {
              name: entry.name,
              path: fullPath,
              isDirectory: entry.isDirectory(),
              isMarkdown: !entry.isDirectory() && (entry.name.endsWith('.md') || entry.name.endsWith('.markdown')),
              mtimeMs
            };
          })
          .sort((a, b) => {
            // Directories first, then files
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            if (sortOrder === 'modified') {
              return b.mtimeMs - a.mtimeMs; // newest first
            }
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

    // Get file sort order
    ipcMain.handle('get-file-sort-order', () => {
      return configStore.getFileSortOrder();
    });

    // Set file sort order
    ipcMain.handle('set-file-sort-order', (event, order) => {
      configStore.setFileSortOrder(order);
    });

    // Scan all markdown files for tags
    ipcMain.handle('get-all-tags', async () => {
      const bucketPath = configStore.getBucketPath();
      if (!bucketPath) return { tags: [] };

      const tagMap = new Map(); // tag -> [{ name, path }]

      function parseTags(content) {
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        if (!match) return [];

        const fm = match[1];
        // Inline format: tags: [a, b, c]
        const inlineMatch = fm.match(/^tags:\s*\[([^\]]*)\]/m);
        if (inlineMatch) {
          return inlineMatch[1].split(',').map(t => t.trim()).filter(Boolean);
        }
        // Multiline format: tags:\n  - a\n  - b
        const multiMatch = fm.match(/^tags:\s*\n((?:\s+-\s+.+\n?)*)/m);
        if (multiMatch) {
          return multiMatch[1].split('\n')
            .map(l => l.replace(/^\s*-\s*/, '').trim())
            .filter(Boolean);
        }
        return [];
      }

      function walk(dir) {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walk(fullPath);
            } else if (entry.name.endsWith('.md') || entry.name.endsWith('.markdown')) {
              try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                const tags = parseTags(content);
                const seen = new Set();
                for (const tag of tags) {
                  if (seen.has(tag)) continue;
                  seen.add(tag);
                  if (!tagMap.has(tag)) tagMap.set(tag, []);
                  tagMap.get(tag).push({ name: entry.name, path: fullPath });
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      }

      walk(bucketPath);

      const tags = Array.from(tagMap.entries())
        .map(([name, files]) => ({ name, files }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return { tags };
    });

    // Scan all markdown files for checkbox todos
    ipcMain.handle('get-all-todos', async () => {
      const bucketPath = configStore.getBucketPath();
      if (!bucketPath) return { open: [], done: [], counts: { open: 0, done: 0, total: 0 } };

      const todos = [];
      const maxFileSize = 1024 * 1024;

      function stripFrontmatter(lines) {
        if (lines[0]?.trim() !== '---') return new Set();
        const skip = new Set([0]);
        for (let i = 1; i < lines.length; i++) {
          skip.add(i);
          if (lines[i].trim() === '---') break;
        }
        return skip;
      }

      function parseTodoText(rawText) {
        const dueMatch = rawText.match(/(?:^|\s)@(\d{4}-\d{2}-\d{2})(?=\s|$)/);
        const priorityMatch = rawText.match(/(?:^|\s)!(high|medium|low)(?=\s|$)/i);
        const tags = Array.from(rawText.matchAll(/(?:^|\s)#([A-Za-z0-9_-]+)/g)).map(match => match[1]);
        const text = rawText
          .replace(/(?:^|\s)@\d{4}-\d{2}-\d{2}(?=\s|$)/g, ' ')
          .replace(/(?:^|\s)!(high|medium|low)(?=\s|$)/gi, ' ')
          .replace(/(?:^|\s)#[A-Za-z0-9_-]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        return {
          text: text || rawText.trim(),
          due: dueMatch ? dueMatch[1] : null,
          priority: priorityMatch ? priorityMatch[1].toLowerCase() : null,
          tags
        };
      }

      function parseTodos(content, filePath) {
        const lines = content.split(/\r?\n/);
        const frontmatterLines = stripFrontmatter(lines);
        const found = [];
        let inFence = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (frontmatterLines.has(i)) continue;

          if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
          }
          if (inFence) continue;

          const match = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s?(.*)$/);
          if (!match) continue;

          const metadata = parseTodoText(match[3]);
          const checked = match[2].toLowerCase() === 'x';
          found.push({
            text: metadata.text,
            rawText: match[3],
            checked,
            due: metadata.due,
            priority: metadata.priority,
            tags: metadata.tags,
            line: i + 1,
            indent: match[1].length,
            file: path.basename(filePath),
            relativePath: path.relative(bucketPath, filePath),
            path: filePath
          });
        }

        return found;
      }

      function walk(dir) {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'pseudo') continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walk(fullPath);
            } else if (entry.name.endsWith('.md') || entry.name.endsWith('.markdown')) {
              try {
                const stat = fs.statSync(fullPath);
                if (stat.size > maxFileSize) continue;
                const content = fs.readFileSync(fullPath, 'utf-8');
                todos.push(...parseTodos(content, fullPath));
              } catch (e) {}
            }
          }
        } catch (e) {}
      }

      walk(bucketPath);

      const priorityRank = { high: 0, medium: 1, low: 2 };
      const sortTodos = (a, b) => {
        if (!!a.due !== !!b.due) return a.due ? -1 : 1;
        if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
        const ap = priorityRank[a.priority] ?? 3;
        const bp = priorityRank[b.priority] ?? 3;
        if (ap !== bp) return ap - bp;
        const fileCompare = a.relativePath.localeCompare(b.relativePath);
        if (fileCompare !== 0) return fileCompare;
        return a.line - b.line;
      };

      const open = todos.filter(todo => !todo.checked).sort(sortTodos);
      const done = todos.filter(todo => todo.checked).sort(sortTodos);
      return {
        open,
        done,
        counts: { open: open.length, done: done.length, total: todos.length }
      };
    });

    // Rename file or folder
    ipcMain.handle('rename-item', async (event, oldPath, newName) => {
      try {
        const dir = path.dirname(oldPath);
        const newPath = path.join(dir, newName);

        if (fs.existsSync(newPath)) {
          return { success: false, error: 'A file with that name already exists' };
        }

        const wasMarkdown = isMarkdownPath(oldPath);
        const oldBasename = path.basename(oldPath, path.extname(oldPath));
        const newBasename = path.basename(newName, path.extname(newName));

        fs.renameSync(oldPath, newPath);

        // Update currentFilePath if we renamed the open file
        if (state.currentFilePath === oldPath) {
          state.currentFilePath = newPath;
          bus.getMainWindow()?.setTitle(`${path.basename(newPath)} - Vomit`);
        }

        // Wikilink rename refactor: update every [[oldBasename]] reference
        // inside the active bucket so links keep resolving. Only for
        // markdown→markdown renames and only when the basename actually
        // changed (case-sensitive match for safety).
        let updatedFiles = 0;
        const bucketRoot = state.currentProjectRoot;
        const stillMarkdown = isMarkdownPath(newPath);
        const inBucket = bucketRoot && newPath.startsWith(bucketRoot);
        if (wasMarkdown && stillMarkdown && inBucket && oldBasename !== newBasename) {
          updatedFiles = updateWikilinkReferences(bucketRoot, oldBasename, newBasename);
          // Reindex the renamed file under its new path and re-resolve
          // anything that referenced the old name.
          try {
            wiki.indexSingleFile(bucketRoot, newPath);
            // Also clean up the old path's notes row if it still hangs around.
            // indexSingleFile handles deletion when the file is missing.
            wiki.indexSingleFile(bucketRoot, oldPath);
            bus.send('wiki-changed', { type: 'rename', oldPath, newPath });
            bus.sendToTerminal('wiki-changed', { type: 'rename', oldPath, newPath });
          } catch {}
        }

        return { success: true, newPath, wikilinksUpdated: updatedFiles };
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

        // Return relative path from current file's directory
        if (bucketPath && state.currentFilePath) {
          const fileDir = path.dirname(state.currentFilePath);
          const relativePath = path.relative(fileDir, filepath);
          return relativePath;
        } else if (bucketPath) {
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

    // Read binary file as base64 (for PDF viewer)
    ipcMain.handle('read-file-base64', async (event, filePath) => {
      try {
        const buffer = fs.readFileSync(filePath);
        return buffer.toString('base64');
      } catch (err) {
        throw new Error(`Failed to read binary file: ${err.message}`);
      }
    });

    ipcMain.handle('read-drawio-file', async (event, filePath) => {
      try {
        const xml = fs.readFileSync(filePath, 'utf-8');
        const diagrams = [];
        const diagramRegex = /<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/gi;
        let match;

        while ((match = diagramRegex.exec(xml)) !== null) {
          const attrs = match[1] || '';
          const body = (match[2] || '').trim();
          const nameMatch = attrs.match(/\bname="([^"]*)"/i);
          const name = nameMatch ? nameMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') : `Diagram ${diagrams.length + 1}`;
          let decoded = null;

          if (body.startsWith('<mxGraphModel')) {
            decoded = body;
          } else if (body) {
            try {
              const inflated = zlib.inflateRawSync(Buffer.from(body, 'base64')).toString('utf-8');
              decoded = decodeURIComponent(inflated);
            } catch {
              decoded = null;
            }
          }

          diagrams.push({ name, xml: decoded });
        }

        return { xml, diagrams };
      } catch (err) {
        throw new Error(`Failed to read draw.io file: ${err.message}`);
      }
    });

    ipcMain.handle('render-drawio-svg', async (event, filePath) => {
      try {
        return await renderDrawioToSvg(filePath);
      } catch (err) {
        throw new Error(`Failed to render draw.io file: ${err.message}`);
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

        // Live-index this file for wikilinks (only markdown, only inside the
        // active bucket). Best-effort — never block the save.
        try {
          const bucketRoot = state.currentProjectRoot;
          if (bucketRoot && isMarkdownPath(filePath) && filePath.startsWith(bucketRoot)) {
            wiki.indexSingleFile(bucketRoot, filePath);
            bus.send('wiki-changed', { type: 'file', path: filePath });
            bus.sendToTerminal('wiki-changed', { type: 'file', path: filePath });
          }
        } catch {}

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

    // Move file or folder to a new location
    ipcMain.handle('move-item', async (event, sourcePath, targetDir) => {
      try {
        const itemName = path.basename(sourcePath);
        const newPath = path.join(targetDir, itemName);

        // Check if source exists
        if (!fs.existsSync(sourcePath)) {
          return { success: false, error: 'Source item does not exist' };
        }

        // Check if target directory exists
        if (!fs.existsSync(targetDir)) {
          return { success: false, error: 'Target directory does not exist' };
        }

        // Check if target already has an item with the same name
        if (fs.existsSync(newPath)) {
          return { success: false, error: 'An item with that name already exists in the target folder' };
        }

        // Prevent moving a folder into itself or its descendants
        if (isSameOrSubPath(targetDir, sourcePath)) {
          return { success: false, error: 'Cannot move a folder into itself' };
        }

        // Perform the move
        fs.renameSync(sourcePath, newPath);

        // Update currentFilePath if we moved the open file
        if (state.currentFilePath === sourcePath) {
          state.currentFilePath = newPath;
          bus.getMainWindow()?.setTitle(`${path.basename(newPath)} - Vomit`);
        } else if (state.currentFilePath && isSameOrSubPath(state.currentFilePath, sourcePath)) {
          // File is inside a moved folder
          const relativePath = path.relative(sourcePath, state.currentFilePath);
          state.currentFilePath = path.join(newPath, relativePath);
          bus.getMainWindow()?.setTitle(`${path.basename(state.currentFilePath)} - Vomit`);
        }

        return { success: true, newPath };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('get-terminal-history', () => configStore.getTerminalHistory());
    ipcMain.handle('set-terminal-history', (event, history) => configStore.setTerminalHistory(history));
    ipcMain.handle('clear-terminal-history', () => configStore.clearTerminalHistory());
  }

  return {
    newFile, newPresentation, openFile,
    loadFile, saveFile, saveFileAs, writeFile,
    stopFileWatcher, startFileWatcher,
    registerHandlers
  };
}

module.exports = { createFileService };

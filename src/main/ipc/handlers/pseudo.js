// @ts-check
'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

/**
 * Git and file operations for the pseudonymization workflow.
 * All git operations use execFileSync to avoid shell injection.
 */
function registerHandlers(ipcMain, { state, configStore }) {
  // Detect git repos (top-level subdirectories with .git)
  ipcMain.handle('pseudo-detect-repos', async (event, bucketPath) => {
    if (!bucketPath || !fs.existsSync(bucketPath)) return [];

    const entries = fs.readdirSync(bucketPath, { withFileTypes: true });
    const repos = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;
      if (entry.name === 'pseudo') continue;

      const dirPath = path.join(bucketPath, entry.name);
      const gitPath = path.join(dirPath, '.git');

      // .git can be a directory or a file (worktrees/submodules)
      if (fs.existsSync(gitPath)) {
        repos.push({ name: entry.name, path: dirPath });
      }
    }

    return repos;
  });

  // Check if mapping.json exists for this bucket
  ipcMain.handle('pseudo-has-mapping', async (event, bucketPath) => {
    const mappingPath = path.join(bucketPath, 'mapping.json');
    return fs.existsSync(mappingPath);
  });

  // Read the mapping
  ipcMain.handle('pseudo-read-mapping', async (event, bucketPath) => {
    const mappingPath = path.join(bucketPath, 'mapping.json');
    if (!fs.existsSync(mappingPath)) return null;
    return JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
  });

  // Save the mapping
  ipcMain.handle('pseudo-save-mapping', async (event, bucketPath, mapping) => {
    fs.writeFileSync(
      path.join(bucketPath, 'mapping.json'),
      JSON.stringify(mapping, null, 2),
      'utf-8',
    );
    return true;
  });

  // Save project metadata
  ipcMain.handle('pseudo-save-project', async (event, bucketPath, projectData) => {
    fs.writeFileSync(
      path.join(bucketPath, 'project.json'),
      JSON.stringify(projectData, null, 2),
      'utf-8',
    );
    return true;
  });

  // Read project metadata
  ipcMain.handle('pseudo-read-project', async (event, bucketPath) => {
    const projectPath = path.join(bucketPath, 'project.json');
    if (!fs.existsSync(projectPath)) return null;
    return JSON.parse(fs.readFileSync(projectPath, 'utf-8'));
  });

  // Initialize a pseudo repo with git and commit baseline
  ipcMain.handle('pseudo-git-init', async (event, repoPath) => {
    try {
      execFileSync('git', ['init'], { cwd: repoPath, stdio: 'pipe' });
      execFileSync('git', ['add', '.'], { cwd: repoPath, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'initial pseudo baseline'], {
        cwd: repoPath,
        stdio: 'pipe',
      });

      // Get the commit hash for tracking
      const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, stdio: 'pipe' })
        .toString()
        .trim();
      return { success: true, baselineHash: hash };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Get changed files in a pseudo repo since baseline
  ipcMain.handle('pseudo-git-changed-files', async (event, repoPath, baselineHash) => {
    try {
      const results = [];

      // Committed changes since baseline
      try {
        const committed = execFileSync('git', ['diff', '--name-only', baselineHash, 'HEAD'], {
          cwd: repoPath,
          stdio: 'pipe',
        })
          .toString()
          .trim();
        if (committed) results.push(...committed.split('\n'));
      } catch {}

      // Staged changes
      try {
        const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
          cwd: repoPath,
          stdio: 'pipe',
        })
          .toString()
          .trim();
        if (staged) results.push(...staged.split('\n'));
      } catch {}

      // Unstaged changes
      try {
        const unstaged = execFileSync('git', ['diff', '--name-only'], {
          cwd: repoPath,
          stdio: 'pipe',
        })
          .toString()
          .trim();
        if (unstaged) results.push(...unstaged.split('\n'));
      } catch {}

      // Untracked files
      try {
        const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
          cwd: repoPath,
          stdio: 'pipe',
        })
          .toString()
          .trim();
        if (untracked) results.push(...untracked.split('\n'));
      } catch {}

      // Deduplicate
      return [...new Set(results.filter((f) => f.length > 0))];
    } catch (err) {
      return [];
    }
  });

  // Remove a directory (for clean rebuild of pseudo repos)
  ipcMain.handle('pseudo-remove-dir', async (event, dirPath) => {
    if (!dirPath || !fs.existsSync(dirPath)) return true;
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
  });

  // Copy a repo's file structure (skipping .git, node_modules, binaries)
  ipcMain.handle('pseudo-copy-structure', async (event, sourcePath, destPath) => {
    const SKIP_DIRS = new Set([
      '.git',
      '.terraform',
      '.terragrunt-cache',
      'node_modules',
      'pseudo',
      'pseudonymized',
      'dist',
      'build',
      'bin',
      'obj',
      '.next',
      'coverage',
      'vendor',
    ]);
    const BINARY_EXTENSIONS = new Set([
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.ico',
      '.svg',
      '.webp',
      '.bmp',
      '.zip',
      '.tar',
      '.gz',
      '.bz2',
      '.7z',
      '.rar',
      '.exe',
      '.dll',
      '.so',
      '.dylib',
      '.bin',
      '.o',
      '.a',
      '.woff',
      '.woff2',
      '.ttf',
      '.eot',
      '.otf',
      '.pdf',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
      '.pptx',
      '.mp3',
      '.mp4',
      '.wav',
      '.avi',
      '.mov',
      '.mkv',
      '.db',
      '.sqlite',
      '.lock',
      '.sum',
      '.pyc',
      '.pyo',
      '.class',
      '.jar',
      '.war',
      '.min.js',
      '.min.css',
      '.map',
    ]);
    let count = 0;

    function copyDir(src, dest) {
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env') continue;
        if (SKIP_DIRS.has(entry.name)) continue;

        const srcPath = path.join(src, entry.name);
        const destPath2 = path.join(dest, entry.name);

        if (entry.isDirectory()) {
          copyDir(srcPath, destPath2);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (!BINARY_EXTENSIONS.has(ext)) {
            if (!fs.existsSync(path.dirname(destPath2))) {
              fs.mkdirSync(path.dirname(destPath2), { recursive: true });
            }
            fs.copyFileSync(srcPath, destPath2);
            count++;
          }
        }
      }
    }

    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(destPath, { recursive: true });
    }
    copyDir(sourcePath, destPath);
    return count;
  });
}

module.exports = { registerHandlers };

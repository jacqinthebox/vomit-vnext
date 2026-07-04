// @ts-check
'use strict';

/**
 * Pure git-output parsing and diff-to-gutter-lines helpers for the git
 * awareness UI. Electron-free (and child_process-free) so `node --test`
 * can load it directly; all git invocation lives in ipc/handlers/git.js.
 */

const { diffLines } = require('diff');

function normalizeEol(text) {
  return String(text == null ? '' : text).replace(/\r\n/g, '\n');
}

/**
 * Parse `git status --porcelain=v1 -z` output.
 * Entries are NUL-separated `XY <path>`; rename/copy entries (X = R or C)
 * are followed by one extra NUL-separated original path, which we consume —
 * the badge belongs to the new path.
 * @param {string} output
 * @returns {Array<{x: string, y: string, relPath: string, origPath?: string}>}
 */
function parsePorcelainZ(output) {
  const entries = [];
  const parts = String(output || '').split('\0').filter((p) => p.length > 0);
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    // Minimum shape: two status chars, a space, and a path.
    if (part.length < 4 || part[2] !== ' ') {
      i++;
      continue;
    }
    const entry = { x: part[0], y: part[1], relPath: part.slice(3) };
    if (entry.x === 'R' || entry.x === 'C' || entry.y === 'R' || entry.y === 'C') {
      entry.origPath = parts[i + 1];
      i++;
    }
    entries.push(entry);
    i++;
  }
  return entries;
}

/**
 * Reduce porcelain entries to a per-file badge status.
 * Worktree-dirty (Y column) wins over staged: a file that is staged AND
 * modified again shows as modified.
 * @param {Array<{x: string, y: string, relPath: string}>} entries
 * @returns {Map<string, 'untracked'|'staged'|'modified'>} keyed by git relPath ('/'-separated)
 */
function classifyStatus(entries) {
  const map = new Map();
  for (const e of entries) {
    if (e.x === '!') continue; // ignored files
    if (e.x === '?') {
      map.set(e.relPath, 'untracked');
      continue;
    }
    const worktreeDirty = e.y === 'M' || e.y === 'D' || e.y === 'A' || e.y === 'R' || e.y === 'C';
    if (worktreeDirty) {
      map.set(e.relPath, 'modified');
    } else if ('MADRC'.includes(e.x)) {
      map.set(e.relPath, 'staged');
    }
  }
  return map;
}

/**
 * Collect every ancestor folder of the given file paths (git '/'-separated
 * relative paths). The repo root itself ('') is excluded.
 * @param {Map<string, string>|Iterable<string>} statusMapOrPaths
 * @returns {Set<string>}
 */
function propagateToFolders(statusMapOrPaths) {
  const paths = statusMapOrPaths instanceof Map ? statusMapOrPaths.keys() : statusMapOrPaths;
  const folders = new Set();
  for (const relPath of paths) {
    const segs = String(relPath).split('/');
    segs.pop(); // drop the filename
    while (segs.length > 0) {
      folders.add(segs.join('/'));
      segs.pop();
    }
  }
  return folders;
}

/**
 * Diff HEAD content against the live buffer and map the result to gutter
 * line sets. Line numbers are 0-based positions in the buffer. A deletion
 * is marked on the line that now follows the removed content (clamped to
 * the last line). CRLF is normalized on both sides so autocrlf checkouts
 * don't mark every line.
 * @param {string} headText
 * @param {string} bufferText
 * @returns {{added: number[], modified: number[], deleted: number[]}}
 */
function computeGutterLines(headText, bufferText) {
  const oldText = normalizeEol(headText);
  const newText = normalizeEol(bufferText);
  const added = [];
  const modified = [];
  const deleted = [];
  if (oldText === newText) return { added, modified, deleted };

  const parts = diffLines(oldText, newText);
  let cursor = 0; // 0-based line position in the buffer
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (part.added) {
      for (let l = 0; l < part.count; l++) added.push(cursor + l);
      cursor += part.count;
      i++;
    } else if (part.removed) {
      const next = parts[i + 1];
      if (next && next.added) {
        // Replacement: pair up removed/added lines as modified; surplus
        // added lines are additions; surplus removed lines are a deletion
        // marker after the block.
        const modCount = Math.min(part.count, next.count);
        for (let l = 0; l < modCount; l++) modified.push(cursor + l);
        for (let l = modCount; l < next.count; l++) added.push(cursor + l);
        if (part.count > next.count) deleted.push(cursor + next.count);
        cursor += next.count;
        i += 2;
      } else {
        // Pure deletion: mark the line now sitting where the content was.
        deleted.push(cursor);
        i++;
      }
    } else {
      cursor += part.count;
      i++;
    }
  }

  const lastLine = Math.max(0, newText.split('\n').length - 1);
  const clamp = (n) => Math.min(Math.max(n, 0), lastLine);
  return {
    added: [...new Set(added)],
    modified: [...new Set(modified)],
    deleted: [...new Set(deleted.map(clamp))]
  };
}

module.exports = {
  parsePorcelainZ,
  classifyStatus,
  propagateToFolders,
  computeGutterLines,
  normalizeEol
};

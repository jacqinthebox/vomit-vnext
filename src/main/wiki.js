// @ts-check
'use strict';

/**
 * Wiki — Obsidian-style [[wikilink]] parser, resolver, and SQLite-backed
 * backlink index. Bucket-scoped database stored under
 * ~/.config/vomit/wiki/<basename>-<hash>.db so a project's links are
 * isolated from others.
 *
 * Phase 1a — parser + index + IPC. UI (highlighting, panel, graph) lives
 * in the renderer; this module only owns parsing, resolving, and storage.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
// Lazy so the pure parsers stay importable under plain node (npm test) —
// better-sqlite3 is compiled against Electron's ABI.
let Database = null;
function getSqlite() {
  if (!Database) Database = require('better-sqlite3');
  return Database;
}

const SKIPPED_DIRS = new Set(['node_modules', 'pseudonymized', '.git', '.obsidian']);
const CONTEXT_RADIUS = 40; // chars on each side of the wikilink

// [[target]] or [[target|alias]] or [[target#heading]] or [[target#heading|alias]] or [[#heading]]
// Avoid matching code spans by allowing anything except ] and | in the target.
const WIKILINK_RE = /\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]/g;

function getWikiDatabasePath(bucketRoot) {
  const configDir = path.join(os.homedir(), '.config', 'vomit', 'wiki');
  const pathHash = crypto.createHash('md5').update(bucketRoot).digest('hex').substring(0, 12);
  const folderName = path.basename(bucketRoot);
  return path.join(configDir, `${folderName}-${pathHash}.db`);
}

function getWikiDatabase(bucketRoot) {
  const configDir = path.join(os.homedir(), '.config', 'vomit', 'wiki');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  const dbPath = getWikiDatabasePath(bucketRoot);
  const db = new (getSqlite())(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS wikilinks (
      source_path TEXT NOT NULL,
      target_text TEXT NOT NULL,
      target_path TEXT,
      alias TEXT,
      heading TEXT,
      line INTEGER NOT NULL,
      col INTEGER NOT NULL,
      context TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wl_target_path ON wikilinks(target_path);
    CREATE INDEX IF NOT EXISTS idx_wl_source_path ON wikilinks(source_path);
    CREATE INDEX IF NOT EXISTS idx_wl_target_text ON wikilinks(target_text);

    CREATE TABLE IF NOT EXISTS notes (
      path TEXT PRIMARY KEY,
      basename TEXT NOT NULL,
      title TEXT,
      mtime INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_basename ON notes(basename);
  `);

  // Migration: standard markdown links (OKF-style) share the table with
  // wikilinks but resolve by path instead of basename, so rows carry a type.
  try {
    db.exec("ALTER TABLE wikilinks ADD COLUMN link_type TEXT NOT NULL DEFAULT 'wiki'");
  } catch {
    // column already exists
  }

  return db;
}

function clearWikiDatabase(bucketRoot) {
  const dbPath = getWikiDatabasePath(bucketRoot);
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  let deleted = 0;
  for (const filePath of files) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      deleted++;
    }
  }
  return { deleted, dbPath };
}

/**
 * Parse all `[[wikilink]]` occurrences in markdown content.
 * Returns parsed link records with raw text, alias, heading, location, and
 * a short surrounding context snippet for display in the backlinks panel.
 *
 * @param {string} content
 * @returns {Array<{target: string, alias: string|null, heading: string|null,
 *   line: number, col: number, context: string, rawTarget: string}>}
 */
function parseWikilinks(content) {
  const links = [];
  if (!content) return links;

  // Pre-compute line offsets so we can map regex indices to line/column.
  const lineOffsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineOffsets.push(i + 1);
  }

  WIKILINK_RE.lastIndex = 0;
  let match;
  while ((match = WIKILINK_RE.exec(content)) !== null) {
    const rawTarget = match[1].trim();
    const alias = match[2] ? match[2].trim() : null;

    // Split target into name + heading. `[[#only-heading]]` has empty name.
    let target = rawTarget;
    let heading = null;
    const hashIdx = rawTarget.indexOf('#');
    if (hashIdx !== -1) {
      target = rawTarget.substring(0, hashIdx).trim();
      heading = rawTarget.substring(hashIdx + 1).trim() || null;
    }

    // Compute line/col from match index using binary search over lineOffsets.
    const idx = match.index;
    let lo = 0,
      hi = lineOffsets.length - 1,
      line = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (lineOffsets[mid] <= idx) {
        line = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const col = idx - lineOffsets[line];

    // Context snippet: ~40 chars either side of the wikilink, single-line.
    const ctxStart = Math.max(0, idx - CONTEXT_RADIUS);
    const ctxEnd = Math.min(content.length, idx + match[0].length + CONTEXT_RADIUS);
    const context = content.substring(ctxStart, ctxEnd).replace(/\s+/g, ' ').trim();

    links.push({
      target,
      rawTarget,
      alias,
      heading,
      line: line + 1, // 1-indexed for editor jumping
      col: col + 1,
      context,
    });
  }

  return links;
}

// [text](target.md) — standard markdown links between notes, as used by OKF
// bundles. Images (![...]) are excluded via the leading capture; targets with
// spaces or parentheses don't participate (nor do titled links).
const MDLINK_RE = /(!?)\[([^\]\n]*)\]\(([^()\s]+)\)/g;

/**
 * Parse standard markdown links to `.md` files (OKF-style concept links).
 * External URLs, images, and non-markdown targets are ignored. Returns the
 * same record shape as parseWikilinks; `target` is the decoded path without
 * any `#heading` suffix.
 *
 * @param {string} content
 * @returns {Array<{target: string, alias: string|null, heading: string|null,
 *   line: number, col: number, context: string, rawTarget: string}>}
 */
function parseMarkdownLinks(content) {
  const links = [];
  if (!content) return links;

  const lineOffsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineOffsets.push(i + 1);
  }

  MDLINK_RE.lastIndex = 0;
  let match;
  while ((match = MDLINK_RE.exec(content)) !== null) {
    if (match[1] === '!') continue; // image embed
    const text = match[2].trim();
    let target = match[3];

    let heading = null;
    const hashIdx = target.indexOf('#');
    if (hashIdx !== -1) {
      heading = target.substring(hashIdx + 1).trim() || null;
      target = target.substring(0, hashIdx);
    }
    if (!target) continue; // same-file anchor
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, mailto:, …
    try {
      target = decodeURIComponent(target);
    } catch {}
    if (!/\.md$/i.test(target)) continue;

    const idx = match.index;
    let lo = 0,
      hi = lineOffsets.length - 1,
      line = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (lineOffsets[mid] <= idx) {
        line = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const col = idx - lineOffsets[line];

    const ctxStart = Math.max(0, idx - CONTEXT_RADIUS);
    const ctxEnd = Math.min(content.length, idx + match[0].length + CONTEXT_RADIUS);
    const context = content.substring(ctxStart, ctxEnd).replace(/\s+/g, ' ').trim();

    links.push({
      target,
      rawTarget: target,
      alias: text || null,
      heading,
      line: line + 1,
      col: col + 1,
      context,
    });
  }

  return links;
}

/**
 * Resolve a standard markdown link path to a note in the bucket. Targets
 * starting with `/` are bucket-root-relative (the OKF convention); all others
 * resolve against the source file's folder. Returns null when the target is
 * not an indexed note (broken link).
 */
function resolveMdTarget(db, bucketRoot, target, sourcePath) {
  if (!target) return sourcePath || null;
  const abs =
    target.startsWith('/') || target.startsWith('\\')
      ? path.join(bucketRoot, target)
      : path.resolve(sourcePath ? path.dirname(sourcePath) : bucketRoot, target);
  const row = db.prepare('SELECT path FROM notes WHERE path = ?').get(path.normalize(abs));
  return row ? row.path : null;
}

/**
 * Resolve a wikilink target string to an absolute file path within the bucket.
 * Match strategy:
 *   1. Exact basename match (case-insensitive). If multiple, prefer the one in
 *      the same directory as the source, then the shortest absolute path.
 *   2. Exact relative-path match (with or without .md extension).
 *   3. Returns null when nothing matches (broken link).
 *
 * @param {Database.Database} db
 * @param {string} bucketRoot
 * @param {string} target — basename without extension, or a relative path
 * @param {string|null} sourcePath — absolute path of the file containing the link
 * @returns {string|null} absolute resolved path or null
 */
function resolveTarget(db, bucketRoot, target, sourcePath) {
  if (!target) {
    // Same-file heading link: caller resolves via sourcePath
    return sourcePath || null;
  }

  const normalized = target.replace(/\.md$/i, '').toLowerCase();

  // Try basename match first
  const rows = db.prepare('SELECT path FROM notes WHERE LOWER(basename) = ?').all(normalized);

  if (rows.length === 1) {
    return rows[0].path;
  }

  if (rows.length > 1 && sourcePath) {
    const sourceDir = path.dirname(sourcePath);
    // Prefer same-directory match
    const sameFolder = rows.find((r) => path.dirname(r.path) === sourceDir);
    if (sameFolder) return sameFolder.path;
    // Otherwise shortest absolute path
    rows.sort((a, b) => a.path.length - b.path.length);
    return rows[0].path;
  }
  if (rows.length > 1) {
    rows.sort((a, b) => a.path.length - b.path.length);
    return rows[0].path;
  }

  // Try relative-path match (with .md appended if missing)
  const relCandidate = target.endsWith('.md') ? target : `${target}.md`;
  const absCandidate = path.resolve(bucketRoot, relCandidate);
  const row = db.prepare('SELECT path FROM notes WHERE path = ?').get(absCandidate);
  return row ? row.path : null;
}

function extractTitle(content) {
  if (!content) return null;
  const m = content.match(/^#\s+(.+?)$/m);
  return m ? m[1].trim() : null;
}

function walkBucket(bucketRoot) {
  const found = [];
  const walk = (dir) => {
    let items;
    try {
      items = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const item of items) {
      if (item.startsWith('.') || SKIPPED_DIRS.has(item)) continue;
      const fullPath = path.join(dir, item);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (item.toLowerCase().endsWith('.md')) {
        found.push(fullPath);
      }
    }
  };
  walk(bucketRoot);
  return found;
}

/**
 * Upsert a single file's notes row + replace its wikilinks rows.
 * Resolution is left to a second pass because we want every note row in
 * place before resolving targets (so basename lookups hit all files).
 */
function indexFileRaw(db, bucketRoot, filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return false;
  }

  const basename = path.basename(filePath, path.extname(filePath));
  const title = extractTitle(content);

  db.prepare(
    `INSERT INTO notes (path, basename, title, mtime) VALUES (?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET basename = excluded.basename,
       title = excluded.title, mtime = excluded.mtime`,
  ).run(filePath, basename, title, stat.mtimeMs);

  db.prepare('DELETE FROM wikilinks WHERE source_path = ?').run(filePath);

  const insert = db.prepare(
    `INSERT INTO wikilinks (source_path, target_text, target_path, alias, heading, line, col, context, link_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const link of parseWikilinks(content)) {
    insert.run(
      filePath,
      link.rawTarget,
      null,
      link.alias,
      link.heading,
      link.line,
      link.col,
      link.context,
      'wiki',
    );
  }
  for (const link of parseMarkdownLinks(content)) {
    insert.run(
      filePath,
      link.rawTarget,
      null,
      link.alias,
      link.heading,
      link.line,
      link.col,
      link.context,
      'md',
    );
  }

  return true;
}

function resolveAllLinks(db, bucketRoot) {
  const rows = db.prepare('SELECT rowid, source_path, target_text, link_type FROM wikilinks').all();
  const update = db.prepare('UPDATE wikilinks SET target_path = ? WHERE rowid = ?');
  for (const row of rows) {
    // Strip any heading suffix from target_text before resolving.
    const hashIdx = row.target_text.indexOf('#');
    const targetName =
      hashIdx === -1 ? row.target_text : row.target_text.substring(0, hashIdx).trim();
    const resolved =
      row.link_type === 'md'
        ? resolveMdTarget(db, bucketRoot, targetName, row.source_path)
        : resolveTarget(db, bucketRoot, targetName, row.source_path);
    update.run(resolved, row.rowid);
  }
}

/**
 * Re-resolve only the wikilinks that point at a given target name. Used after
 * a single file change to update its inbound links without rescanning the
 * whole bucket.
 */
function resolveLinksForName(db, bucketRoot, basename) {
  const name = basename.toLowerCase();
  // Wikilinks reference the bare name; markdown links reference a path ending
  // in <name>.md — cover both so a new file repairs its inbound links.
  const rows = db
    .prepare(
      `SELECT rowid, source_path, target_text, link_type FROM wikilinks
     WHERE (link_type = 'wiki' AND (LOWER(target_text) = ? OR LOWER(target_text) LIKE ?))
        OR (link_type = 'md' AND (LOWER(target_text) = ? OR LOWER(target_text) LIKE ?))`,
    )
    .all(name, `${name}#%`, `${name}.md`, `%/${name}.md`);
  const update = db.prepare('UPDATE wikilinks SET target_path = ? WHERE rowid = ?');
  for (const row of rows) {
    const hashIdx = row.target_text.indexOf('#');
    const targetName =
      hashIdx === -1 ? row.target_text : row.target_text.substring(0, hashIdx).trim();
    const resolved =
      row.link_type === 'md'
        ? resolveMdTarget(db, bucketRoot, targetName, row.source_path)
        : resolveTarget(db, bucketRoot, targetName, row.source_path);
    update.run(resolved, row.rowid);
  }
}

/**
 * Full bucket reindex. Slow on first run, fine for buckets up to ~10K notes.
 * Wrapped in a single transaction for speed.
 */
async function indexBucket(bucketRoot, progressCallback) {
  if (!fs.existsSync(bucketRoot)) {
    throw new Error(`Bucket not found: ${bucketRoot}`);
  }

  const db = getWikiDatabase(bucketRoot);

  try {
    const files = walkBucket(bucketRoot);

    const reindex = db.transaction(() => {
      db.exec('DELETE FROM wikilinks; DELETE FROM notes;');
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        indexFileRaw(db, bucketRoot, file);
        if (progressCallback) {
          progressCallback({
            status: 'indexing',
            current: i + 1,
            total: files.length,
            file: path.relative(bucketRoot, file),
          });
        }
      }
      resolveAllLinks(db, bucketRoot);
    });

    reindex();

    const linkCount = db.prepare('SELECT COUNT(*) AS c FROM wikilinks').get().c;
    const brokenCount = db
      .prepare('SELECT COUNT(*) AS c FROM wikilinks WHERE target_path IS NULL')
      .get().c;

    return {
      filesProcessed: files.length,
      linksIndexed: linkCount,
      brokenLinks: brokenCount,
    };
  } finally {
    db.close();
  }
}

/**
 * Incremental reindex for a single file. Re-resolves both its outbound links
 * and any inbound links that reference its basename (covers the case where a
 * new file makes previously-broken links resolve).
 */
function indexSingleFile(bucketRoot, filePath) {
  const db = getWikiDatabase(bucketRoot);
  try {
    const existed = fs.existsSync(filePath);
    if (!existed) {
      // File was deleted — remove its notes row and rebreak inbound links.
      const oldBasename = path.basename(filePath, path.extname(filePath));
      db.prepare('DELETE FROM notes WHERE path = ?').run(filePath);
      db.prepare('DELETE FROM wikilinks WHERE source_path = ?').run(filePath);
      resolveLinksForName(db, bucketRoot, oldBasename);
      return { removed: true };
    }

    indexFileRaw(db, bucketRoot, filePath);

    // Resolve outbound: re-resolve every link from this file.
    const outbound = db
      .prepare('SELECT rowid, target_text, link_type FROM wikilinks WHERE source_path = ?')
      .all(filePath);
    const update = db.prepare('UPDATE wikilinks SET target_path = ? WHERE rowid = ?');
    for (const row of outbound) {
      const hashIdx = row.target_text.indexOf('#');
      const targetName =
        hashIdx === -1 ? row.target_text : row.target_text.substring(0, hashIdx).trim();
      const resolved =
        row.link_type === 'md'
          ? resolveMdTarget(db, bucketRoot, targetName, filePath)
          : resolveTarget(db, bucketRoot, targetName, filePath);
      update.run(resolved, row.rowid);
    }

    // Resolve inbound: re-resolve any link in the bucket that names this file.
    const basename = path.basename(filePath, path.extname(filePath));
    resolveLinksForName(db, bucketRoot, basename);

    return { indexed: true, outboundLinks: outbound.length };
  } finally {
    db.close();
  }
}

/**
 * Return backlink rows targeting the given absolute file path.
 * Each row carries source_path, line, col, context, plus the source's title
 * for nicer rendering in the panel.
 */
function getBacklinks(bucketRoot, targetPath) {
  const dbPath = getWikiDatabasePath(bucketRoot);
  if (!fs.existsSync(dbPath)) return [];

  const db = getWikiDatabase(bucketRoot);
  try {
    return db
      .prepare(
        `SELECT w.source_path, w.line, w.col, w.context, w.alias, w.heading,
              n.title AS source_title, n.basename AS source_basename
       FROM wikilinks w
       LEFT JOIN notes n ON n.path = w.source_path
       WHERE w.target_path = ?
       ORDER BY w.source_path, w.line`,
      )
      .all(targetPath);
  } finally {
    db.close();
  }
}

/**
 * Resolve a wikilink target string in the context of a source file.
 * Used by the renderer when Cmd+clicking a wikilink in the editor.
 */
function resolveWikilink(bucketRoot, target, sourcePath) {
  const dbPath = getWikiDatabasePath(bucketRoot);
  if (!fs.existsSync(dbPath)) return null;

  const db = getWikiDatabase(bucketRoot);
  try {
    // Strip heading suffix if any
    const hashIdx = target.indexOf('#');
    const targetName = hashIdx === -1 ? target : target.substring(0, hashIdx).trim();
    const heading = hashIdx === -1 ? null : target.substring(hashIdx + 1).trim();
    const resolvedPath = resolveTarget(db, bucketRoot, targetName, sourcePath);
    return { path: resolvedPath, heading };
  } finally {
    db.close();
  }
}

/** Return all note basenames for the `[[` autocomplete picker. */
function listNotes(bucketRoot) {
  const dbPath = getWikiDatabasePath(bucketRoot);
  if (!fs.existsSync(dbPath)) return [];

  const db = getWikiDatabase(bucketRoot);
  try {
    return db.prepare('SELECT path, basename, title FROM notes ORDER BY basename').all();
  } finally {
    db.close();
  }
}

/**
 * Return the full link graph for the bucket: nodes = notes, edges = resolved
 * wikilinks. Broken links are omitted to keep the graph clean; the renderer
 * can request a `broken` list separately if desired.
 */
function getGraph(bucketRoot) {
  const dbPath = getWikiDatabasePath(bucketRoot);
  if (!fs.existsSync(dbPath)) return { nodes: [], edges: [] };

  const db = getWikiDatabase(bucketRoot);
  try {
    const nodes = db.prepare('SELECT path AS id, basename, title FROM notes').all();
    const edges = db
      .prepare(
        `SELECT source_path AS source, target_path AS target
       FROM wikilinks WHERE target_path IS NOT NULL`,
      )
      .all();
    return { nodes, edges };
  } finally {
    db.close();
  }
}

function registerHandlers(ipcMain, { state, bus }) {
  const progressCallback = (progress) => {
    bus.send('wiki-progress', progress);
    bus.sendToTerminal('wiki-progress', progress);
  };

  ipcMain.handle('okf-export', async (event, bucketRoot) => {
    try {
      const { exportBucket } = require('./services/okfExport');
      const result = await exportBucket(bucketRoot);
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('wiki-index', async (event, bucketRoot) => {
    try {
      const result = await indexBucket(bucketRoot, progressCallback);
      bus.send('wiki-changed', { type: 'reindex' });
      bus.sendToTerminal('wiki-changed', { type: 'reindex' });
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('wiki-clear', async (event, bucketRoot) => {
    try {
      return { success: true, ...clearWikiDatabase(bucketRoot) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Fire-and-forget single-file reindex (renderer calls after save).
  ipcMain.on('wiki-index-file', (event, bucketRoot, filePath) => {
    try {
      indexSingleFile(bucketRoot, filePath);
      bus.send('wiki-changed', { type: 'file', path: filePath });
      bus.sendToTerminal('wiki-changed', { type: 'file', path: filePath });
    } catch {
      // Silently swallow — indexing failures should never break editing.
    }
  });

  ipcMain.handle('wiki-backlinks', (event, bucketRoot, targetPath) => {
    try {
      return { success: true, backlinks: getBacklinks(bucketRoot, targetPath) };
    } catch (e) {
      return { success: false, error: e.message, backlinks: [] };
    }
  });

  ipcMain.handle('wiki-resolve', (event, bucketRoot, target, sourcePath) => {
    try {
      return { success: true, ...resolveWikilink(bucketRoot, target, sourcePath) };
    } catch (e) {
      return { success: false, error: e.message, path: null };
    }
  });

  ipcMain.handle('wiki-list-notes', (event, bucketRoot) => {
    try {
      return { success: true, notes: listNotes(bucketRoot) };
    } catch (e) {
      return { success: false, error: e.message, notes: [] };
    }
  });

  ipcMain.handle('wiki-graph', (event, bucketRoot) => {
    try {
      return { success: true, ...getGraph(bucketRoot) };
    } catch (e) {
      return { success: false, error: e.message, nodes: [], edges: [] };
    }
  });
}

module.exports = {
  parseWikilinks,
  parseMarkdownLinks,
  resolveTarget,
  resolveWikilink,
  indexBucket,
  indexSingleFile,
  getBacklinks,
  listNotes,
  getGraph,
  clearWikiDatabase,
  getWikiDatabasePath,
  registerHandlers,
};

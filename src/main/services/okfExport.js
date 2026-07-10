// @ts-check
'use strict';

/**
 * OKF (Open Knowledge Format) bundle export. Copies the bucket's markdown
 * notes into a staging folder, stamps a `type:` frontmatter field where
 * missing (the only field OKF requires), rewrites [[wikilinks]] to standard
 * bucket-root-relative markdown links, and packs the result as a tar.gz.
 * Source notes are never modified.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const SKIPPED_DIRS = new Set(['node_modules', 'pseudonymized', '.git', '.obsidian']);

// Same pattern as wiki.js: [[target]] / [[target|alias]] / [[target#heading]]
const WIKILINK_RE = /\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]/g;

function walkMarkdown(bucketRoot) {
  const found = [];
  const walk = (dir) => {
    let items;
    try { items = fs.readdirSync(dir); } catch { return; }
    for (const item of items) {
      if (item.startsWith('.') || SKIPPED_DIRS.has(item)) continue;
      const fullPath = path.join(dir, item);
      let stat;
      try { stat = fs.statSync(fullPath); } catch { continue; }
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
 * Ensure the note has YAML frontmatter with a `type:` field — OKF's only
 * mandatory field. Existing frontmatter and its fields are preserved.
 */
function stampType(content, defaultType = 'Note') {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!m) {
    return { content: `---\ntype: ${defaultType}\n---\n\n${content}`, stamped: true };
  }
  if (/^type\s*:/m.test(m[1])) {
    return { content, stamped: false };
  }
  const insertAt = content.indexOf('\n') + 1; // right after the opening ---
  return {
    content: content.slice(0, insertAt) + `type: ${defaultType}\n` + content.slice(insertAt),
    stamped: true
  };
}

/**
 * Wikilink resolver over a plain file list, mirroring wiki.js resolveTarget:
 * case-insensitive basename match, prefer the source's directory, then the
 * shortest path; falls back to a bucket-root-relative path match.
 */
function makeResolver(bucketRoot, files) {
  const fileSet = new Set(files);
  const byBase = new Map();
  for (const f of files) {
    const base = path.basename(f, path.extname(f)).toLowerCase();
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(f);
  }
  return (target, sourcePath) => {
    const name = target.replace(/\.md$/i, '').toLowerCase();
    const rows = byBase.get(name) || [];
    if (rows.length === 1) return rows[0];
    if (rows.length > 1) {
      const sourceDir = path.dirname(sourcePath);
      const same = rows.find(r => path.dirname(r) === sourceDir);
      if (same) return same;
      return [...rows].sort((a, b) => a.length - b.length)[0];
    }
    const relCandidate = /\.md$/i.test(target) ? target : `${target}.md`;
    const abs = path.resolve(bucketRoot, relCandidate);
    return fileSet.has(abs) ? abs : null;
  };
}

/**
 * Rewrite [[wikilinks]] to standard markdown links with bucket-root-relative
 * targets (`[label](/notes/foo.md)`), the OKF convention. Unresolvable links
 * are left untouched and counted as broken.
 */
function rewriteWikilinks(content, bucketRoot, filePath, resolve) {
  let rewritten = 0;
  let broken = 0;
  const out = content.replace(WIKILINK_RE, (whole, rawTarget, alias) => {
    let name = rawTarget.trim();
    let heading = null;
    const hashIdx = name.indexOf('#');
    if (hashIdx !== -1) {
      heading = name.substring(hashIdx + 1).trim() || null;
      name = name.substring(0, hashIdx).trim();
    }
    const abs = name ? resolve(name, filePath) : filePath;
    if (!abs) {
      broken++;
      return whole;
    }
    // Percent-encode only what breaks markdown link syntax.
    const rel = '/' + path.relative(bucketRoot, abs).split(path.sep).join('/')
      .replace(/[ ()]/g, (c) => ({ ' ': '%20', '(': '%28', ')': '%29' }[c]));
    const label = (alias && alias.trim()) || name || heading || '';
    const suffix = heading ? `#${heading}` : '';
    rewritten++;
    return `[${label}](${rel}${suffix})`;
  });
  return { content: out, rewritten, broken };
}

/**
 * Export the bucket as an OKF bundle tarball. Returns counts and the output
 * path. Default output: ~/Downloads/<bucket>-okf.tar.gz
 */
async function exportBucket(bucketRoot, outputPath = null) {
  if (!bucketRoot || !fs.existsSync(bucketRoot)) {
    throw new Error(`Bucket not found: ${bucketRoot}`);
  }
  const files = walkMarkdown(bucketRoot);
  if (!files.length) {
    throw new Error('No markdown notes found in this bucket.');
  }

  const resolve = makeResolver(bucketRoot, files);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'vomit-okf-'));
  let stamped = 0;
  let linksRewritten = 0;
  let brokenLinks = 0;

  for (const file of files) {
    const rel = path.relative(bucketRoot, file);
    let content = fs.readFileSync(file, 'utf-8');

    const s = stampType(content);
    content = s.content;
    if (s.stamped) stamped++;

    const r = rewriteWikilinks(content, bucketRoot, file, resolve);
    content = r.content;
    linksRewritten += r.rewritten;
    brokenLinks += r.broken;

    const dest = path.join(staging, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }

  const out = outputPath
    || path.join(os.homedir(), 'Downloads', `${path.basename(bucketRoot)}-okf.tar.gz`);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  // tar ships with macOS, Linux, and Windows 10+.
  await new Promise((res, rej) => {
    execFile('tar', ['-czf', out, '-C', staging, '.'], (err) => {
      if (err) {
        rej(new Error(`tar failed: ${err.message}. Transformed notes were left in ${staging}`));
      } else {
        res(undefined);
      }
    });
  });
  fs.rmSync(staging, { recursive: true, force: true });

  return { notes: files.length, stamped, linksRewritten, brokenLinks, output: out };
}

module.exports = { exportBucket, stampType, rewriteWikilinks, makeResolver };

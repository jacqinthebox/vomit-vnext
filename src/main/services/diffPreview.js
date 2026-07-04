// @ts-check
'use strict';

/**
 * Unified-diff preview for the agent's diff-before-write approval gate.
 * Electron-free so `node --test` can load it directly.
 */

const { structuredPatch } = require('diff');
const { normalizeEol } = require('./gitUtils');

const DEFAULT_MAX_LINES = 400;

/**
 * Build a terminal-renderable unified diff between the current file content
 * and the proposed content, with a `git diff --stat`-style header.
 * @param {string} displayPath path shown in the header (repo-relative when known)
 * @param {string} oldContent current content ('' for a new file)
 * @param {string} newContent proposed content
 * @param {{maxLines?: number}} [opts]
 * @returns {{header: string, text: string, stats: {added: number, removed: number}, truncated: boolean}}
 */
function buildWriteDiff(displayPath, oldContent, newContent, opts = {}) {
  const maxLines = opts.maxLines || DEFAULT_MAX_LINES;
  const oldText = normalizeEol(oldContent);
  const newText = normalizeEol(newContent);

  const patch = structuredPatch(displayPath, displayPath, oldText, newText, '', '', { context: 3 });

  let added = 0;
  let removed = 0;
  const lines = [];
  for (const hunk of patch.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
      lines.push(line);
    }
  }

  const truncated = lines.length > maxLines;
  const shown = truncated ? lines.slice(0, maxLines) : lines;
  let text = shown.join('\n');
  if (truncated) {
    text += `\n… (${lines.length - maxLines} more lines not shown)`;
  }
  if (lines.length === 0) {
    text = '(no changes — proposed content is identical)';
  }

  return {
    header: `${displayPath} | +${added} -${removed}`,
    text,
    stats: { added, removed },
    truncated
  };
}

module.exports = { buildWriteDiff, DEFAULT_MAX_LINES };

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildWriteDiff } = require('../src/main/services/diffPreview');

test('counts added and removed lines and formats the header', () => {
  const r = buildWriteDiff('notes/todo.md', 'a\nb\nc\n', 'a\nX\nc\nd\n');
  assert.strictEqual(r.stats.added, 2); // X + d
  assert.strictEqual(r.stats.removed, 1); // b
  assert.strictEqual(r.header, 'notes/todo.md | +2 -1');
  assert.match(r.text, /^@@ /m);
  assert.match(r.text, /^\+X$/m);
  assert.match(r.text, /^-b$/m);
});

test('new file (empty old content) is all additions', () => {
  const r = buildWriteDiff('new.md', '', 'line1\nline2\n');
  assert.strictEqual(r.stats.added, 2);
  assert.strictEqual(r.stats.removed, 0);
  assert.strictEqual(r.truncated, false);
});

test('identical content produces a no-changes note', () => {
  const r = buildWriteDiff('same.md', 'a\n', 'a\n');
  assert.strictEqual(r.stats.added, 0);
  assert.strictEqual(r.stats.removed, 0);
  assert.match(r.text, /no changes/);
});

test('long diffs are truncated with a note', () => {
  const oldText = '';
  const newText = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n');
  const r = buildWriteDiff('big.md', oldText, newText, { maxLines: 50 });
  assert.strictEqual(r.truncated, true);
  assert.ok(r.text.split('\n').length <= 52);
  assert.match(r.text, /more lines not shown/);
  assert.strictEqual(r.stats.added, 1000); // stats count the full diff, not the shown part
});

test('CRLF-only differences show no changes', () => {
  const r = buildWriteDiff('crlf.md', 'a\r\nb\r\n', 'a\nb\n');
  assert.strictEqual(r.stats.added + r.stats.removed, 0);
});

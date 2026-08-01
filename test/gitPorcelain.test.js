'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parsePorcelainZ, classifyStatus } = require('../src/main/services/gitUtils');

const NUL = '\0';

test('parses modified, staged, and untracked entries', () => {
  const out = ` M notes/todo.md${NUL}M  staged.md${NUL}?? new-file.md${NUL}`;
  const entries = parsePorcelainZ(out);
  assert.deepStrictEqual(
    entries.map((e) => [e.x, e.y, e.relPath]),
    [
      [' ', 'M', 'notes/todo.md'],
      ['M', ' ', 'staged.md'],
      ['?', '?', 'new-file.md'],
    ],
  );
});

test('rename entries consume the original path and keep the new path', () => {
  const out = `R  new-name.md${NUL}old-name.md${NUL} M other.md${NUL}`;
  const entries = parsePorcelainZ(out);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].relPath, 'new-name.md');
  assert.strictEqual(entries[0].origPath, 'old-name.md');
  assert.strictEqual(entries[1].relPath, 'other.md');
});

test('handles paths with spaces and unicode (no quoting in -z mode)', () => {
  const out = ` M my notes/für später.md${NUL}`;
  const entries = parsePorcelainZ(out);
  assert.strictEqual(entries[0].relPath, 'my notes/für später.md');
});

test('empty and garbage input produce no entries', () => {
  assert.deepStrictEqual(parsePorcelainZ(''), []);
  assert.deepStrictEqual(parsePorcelainZ(null), []);
  assert.deepStrictEqual(parsePorcelainZ(`x${NUL}`), []);
});

test('classifyStatus: worktree-dirty wins over staged', () => {
  const map = classifyStatus([
    { x: 'M', y: 'M', relPath: 'both.md' },
    { x: 'A', y: 'M', relPath: 'added-then-edited.md' },
    { x: 'M', y: ' ', relPath: 'staged-only.md' },
    { x: 'A', y: ' ', relPath: 'staged-new.md' },
    { x: ' ', y: 'M', relPath: 'worktree-only.md' },
    { x: ' ', y: 'D', relPath: 'deleted-worktree.md' },
    { x: '?', y: '?', relPath: 'untracked.md' },
    { x: '!', y: '!', relPath: 'ignored.md' },
  ]);
  assert.strictEqual(map.get('both.md'), 'modified');
  assert.strictEqual(map.get('added-then-edited.md'), 'modified');
  assert.strictEqual(map.get('staged-only.md'), 'staged');
  assert.strictEqual(map.get('staged-new.md'), 'staged');
  assert.strictEqual(map.get('worktree-only.md'), 'modified');
  assert.strictEqual(map.get('deleted-worktree.md'), 'modified');
  assert.strictEqual(map.get('untracked.md'), 'untracked');
  assert.strictEqual(map.has('ignored.md'), false);
});

test('classifyStatus: staged rename is staged', () => {
  const map = classifyStatus([{ x: 'R', y: ' ', relPath: 'renamed.md', origPath: 'old.md' }]);
  assert.strictEqual(map.get('renamed.md'), 'staged');
});

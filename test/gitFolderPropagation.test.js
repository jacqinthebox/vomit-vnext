'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { propagateToFolders } = require('../src/main/services/gitUtils');

test('every ancestor folder is collected', () => {
  const folders = propagateToFolders(['a/b/c/file.md']);
  assert.deepStrictEqual([...folders].sort(), ['a', 'a/b', 'a/b/c']);
});

test('root-level files add no folders', () => {
  assert.deepStrictEqual([...propagateToFolders(['file.md'])], []);
});

test('overlapping paths are deduplicated', () => {
  const folders = propagateToFolders(['docs/x.md', 'docs/sub/y.md']);
  assert.deepStrictEqual([...folders].sort(), ['docs', 'docs/sub']);
});

test('accepts a Map (statusMap) as input', () => {
  const map = new Map([['notes/todo.md', 'modified']]);
  assert.deepStrictEqual([...propagateToFolders(map)], ['notes']);
});

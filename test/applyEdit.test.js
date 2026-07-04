'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { applyEdit } = require('../src/main/services/agentTools');

test('replaces a unique match', () => {
  const result = applyEdit('const a = 1;\nconst b = 2;', 'const b = 2;', 'const b = 3;');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.content, 'const a = 1;\nconst b = 3;');
  assert.strictEqual(result.count, 1);
});

test('errors when old_string is not found', () => {
  const result = applyEdit('hello world', 'goodbye', 'hi');
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /not found/);
});

test('errors on multiple matches without replace_all', () => {
  const result = applyEdit('aaa bbb aaa', 'aaa', 'ccc');
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /matched 2 times/);
});

test('replace_all replaces every occurrence', () => {
  const result = applyEdit('aaa bbb aaa', 'aaa', 'ccc', true);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.content, 'ccc bbb ccc');
  assert.strictEqual(result.count, 2);
});

test('regex special characters are treated literally', () => {
  const result = applyEdit('price is $1.50 (sale)', '$1.50 (sale)', '$2.00');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.content, 'price is $2.00');
});

test('replacement strings with $ patterns are not expanded', () => {
  const result = applyEdit('let x = OLD;', 'OLD', "'$&$1'");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.content, "let x = '$&$1';");
});

test('empty old_string is rejected', () => {
  const result = applyEdit('content', '', 'x');
  assert.strictEqual(result.ok, false);
});

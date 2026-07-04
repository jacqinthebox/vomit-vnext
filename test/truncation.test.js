'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { truncateForModel, pageFileContent, LIMITS } = require('../src/main/services/agentTools');

test('short text passes through untouched', () => {
  assert.strictEqual(truncateForModel('hello'), 'hello');
  assert.strictEqual(truncateForModel(''), '');
  assert.strictEqual(truncateForModel(null), '');
});

test('long text keeps head and tail with a marker', () => {
  const text = 'a'.repeat(6000) + 'MIDDLE' + 'b'.repeat(6000);
  const result = truncateForModel(text);
  assert.ok(result.length < text.length);
  assert.ok(result.startsWith('a'.repeat(100)));
  assert.ok(result.endsWith('b'.repeat(100)));
  assert.match(result, /truncated \d+ chars/);
});

test('text exactly at the limit is not truncated', () => {
  const text = 'x'.repeat(LIMITS.MODEL_RESULT_MAX_CHARS);
  assert.strictEqual(truncateForModel(text), text);
});

test('pageFileContent returns whole small files without a notice', () => {
  const content = 'line1\nline2\nline3';
  assert.strictEqual(pageFileContent(content), content);
});

test('pageFileContent slices by offset and limit with continuation notice', () => {
  const content = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');
  const result = pageFileContent(content, 3, 2);
  assert.ok(result.startsWith('line3\nline4'));
  assert.match(result, /showed lines 3-4 of 10/);
  assert.match(result, /offset=5/);
});

test('pageFileContent caps line count at the default maximum', () => {
  const content = Array.from({ length: 3000 }, (_, i) => `l${i}`).join('\n');
  const result = pageFileContent(content);
  assert.match(result, /showed lines 1-2000 of 3000/);
  assert.match(result, /offset=2001/);
});

test('pageFileContent rejects offsets past the end', () => {
  assert.match(pageFileContent('one\ntwo', 99), /^Error: offset 99 is past the end/);
});

test('pageFileContent enforces the byte cap', () => {
  const bigLine = 'x'.repeat(60 * 1024);
  const content = [bigLine, bigLine, bigLine].join('\n');
  const result = pageFileContent(content);
  assert.match(result, /showed lines 1-1 of 3/);
});

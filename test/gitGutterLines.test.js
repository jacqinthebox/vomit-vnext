'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { computeGutterLines } = require('../src/main/services/gitUtils');

test('identical content yields no markers', () => {
  const r = computeGutterLines('a\nb\nc\n', 'a\nb\nc\n');
  assert.deepStrictEqual(r, { added: [], modified: [], deleted: [] });
});

test('pure additions are marked added at their buffer lines', () => {
  const r = computeGutterLines('a\nc\n', 'a\nb\nc\n');
  assert.deepStrictEqual(r.added, [1]);
  assert.deepStrictEqual(r.modified, []);
  assert.deepStrictEqual(r.deleted, []);
});

test('appending at EOF marks the new lines added', () => {
  const r = computeGutterLines('a\n', 'a\nb\nc\n');
  assert.deepStrictEqual(r.added, [1, 2]);
});

test('a changed line is modified, not added', () => {
  const r = computeGutterLines('a\nb\nc\n', 'a\nX\nc\n');
  assert.deepStrictEqual(r.modified, [1]);
  assert.deepStrictEqual(r.added, []);
  assert.deepStrictEqual(r.deleted, []);
});

test('replacement with more new lines: paired modified plus surplus added', () => {
  const r = computeGutterLines('a\nb\nc\n', 'a\nX\nY\nc\n');
  assert.deepStrictEqual(r.modified, [1]);
  assert.deepStrictEqual(r.added, [2]);
});

test('replacement with fewer new lines: modified plus a deletion marker after', () => {
  const r = computeGutterLines('a\nb\nc\nd\n', 'a\nX\nd\n');
  assert.deepStrictEqual(r.modified, [1]);
  assert.ok(r.deleted.includes(2));
});

test('pure deletion marks the following line', () => {
  const r = computeGutterLines('a\nb\nc\n', 'a\nc\n');
  assert.deepStrictEqual(r.deleted, [1]);
  assert.deepStrictEqual(r.added, []);
  assert.deepStrictEqual(r.modified, []);
});

test('deletion of the first line marks line 0', () => {
  const r = computeGutterLines('a\nb\n', 'b\n');
  assert.deepStrictEqual(r.deleted, [0]);
});

test('deletion at EOF clamps to the last buffer line', () => {
  const r = computeGutterLines('a\nb\nc\n', 'a\n');
  assert.strictEqual(r.deleted.length, 1);
  assert.ok(r.deleted[0] <= 1, `marker ${r.deleted[0]} beyond last line`);
});

test('CRLF-only differences produce no markers', () => {
  const r = computeGutterLines('a\r\nb\r\nc\r\n', 'a\nb\nc\n');
  assert.deepStrictEqual(r, { added: [], modified: [], deleted: [] });
});

test('empty HEAD (new tracked file) marks all lines added', () => {
  const r = computeGutterLines('', 'a\nb\n');
  assert.deepStrictEqual(r.modified.concat(r.deleted), []);
  assert.ok(r.added.includes(0) && r.added.includes(1));
});

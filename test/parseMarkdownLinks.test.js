'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseMarkdownLinks } = require('../src/main/wiki');

test('parses a plain relative markdown link', () => {
  const links = parseMarkdownLinks('Joined with [customers](tables/customers.md) on id.');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].target, 'tables/customers.md');
  assert.strictEqual(links[0].alias, 'customers');
  assert.strictEqual(links[0].heading, null);
});

test('parses bucket-root-relative links (OKF convention)', () => {
  const links = parseMarkdownLinks('FK to [customers](/tables/customers.md).');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].target, '/tables/customers.md');
});

test('splits heading suffix from the target', () => {
  const links = parseMarkdownLinks('See [joins](orders.md#joins).');
  assert.strictEqual(links[0].target, 'orders.md');
  assert.strictEqual(links[0].heading, 'joins');
});

test('decodes percent-encoded paths', () => {
  const links = parseMarkdownLinks('See [notes](my%20notes.md).');
  assert.strictEqual(links[0].target, 'my notes.md');
});

test('ignores images, external URLs, anchors, and non-md targets', () => {
  const content = [
    '![diagram](architecture.md)',
    '[site](https://example.com/page.md)',
    '[mail](mailto:a@b.nl)',
    '[jump](#section)',
    '[data](export.csv)',
    '[parent](../up.md)'
  ].join('\n');
  const links = parseMarkdownLinks(content);
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].target, '../up.md');
});

test('reports 1-indexed line numbers', () => {
  const links = parseMarkdownLinks('first line\n\nsee [x](x.md)');
  assert.strictEqual(links[0].line, 3);
});

test('empty alias falls back to null', () => {
  const links = parseMarkdownLinks('[](target.md)');
  assert.strictEqual(links[0].alias, null);
});

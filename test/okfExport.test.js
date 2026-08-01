'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { stampType, rewriteWikilinks, makeResolver } = require('../src/main/services/okfExport');

const ROOT = path.resolve('/bucket');
const abs = (p) => path.join(ROOT, p);

test('stampType adds frontmatter when there is none', () => {
  const r = stampType('# Hello\n\nBody.');
  assert.strictEqual(r.stamped, true);
  assert.ok(r.content.startsWith('---\ntype: Note\n---\n\n# Hello'));
});

test('stampType inserts type into existing frontmatter, preserving fields', () => {
  const r = stampType('---\ntitle: Orders\ntags: [sales]\n---\n\n# Orders\n');
  assert.strictEqual(r.stamped, true);
  assert.ok(r.content.startsWith('---\ntype: Note\ntitle: Orders\ntags: [sales]\n---'));
});

test('stampType leaves notes that already have a type untouched', () => {
  const src = '---\ntype: BigQuery Table\n---\n\n# Orders\n';
  const r = stampType(src);
  assert.strictEqual(r.stamped, false);
  assert.strictEqual(r.content, src);
});

test('rewriteWikilinks converts to bucket-root-relative markdown links', () => {
  const resolve = () => abs('tables/customers.md');
  const r = rewriteWikilinks('See [[customers]].', ROOT, abs('orders.md'), resolve);
  assert.strictEqual(r.content, 'See [customers](/tables/customers.md).');
  assert.strictEqual(r.rewritten, 1);
  assert.strictEqual(r.broken, 0);
});

test('rewriteWikilinks keeps alias and heading', () => {
  const resolve = () => abs('tables/customers.md');
  const r = rewriteWikilinks(
    'See [[customers#joins|our clients]].',
    ROOT,
    abs('orders.md'),
    resolve,
  );
  assert.strictEqual(r.content, 'See [our clients](/tables/customers.md#joins).');
});

test('rewriteWikilinks leaves broken links untouched and counts them', () => {
  const r = rewriteWikilinks('See [[missing]].', ROOT, abs('orders.md'), () => null);
  assert.strictEqual(r.content, 'See [[missing]].');
  assert.strictEqual(r.broken, 1);
});

test('rewriteWikilinks percent-encodes spaces in targets', () => {
  const resolve = () => abs('my notes.md');
  const r = rewriteWikilinks('See [[my notes]].', ROOT, abs('a.md'), resolve);
  assert.strictEqual(r.content, 'See [my notes](/my%20notes.md).');
});

test('makeResolver matches basename case-insensitively and prefers same dir', () => {
  const files = [abs('a/customers.md'), abs('b/customers.md')];
  const resolve = makeResolver(ROOT, files);
  assert.strictEqual(resolve('Customers', abs('b/orders.md')), abs('b/customers.md'));
});

test('makeResolver falls back to bucket-relative path match', () => {
  const files = [abs('tables/orders.md')];
  const resolve = makeResolver(ROOT, files);
  assert.strictEqual(resolve('tables/orders', abs('x.md')), abs('tables/orders.md'));
  assert.strictEqual(resolve('nope', abs('x.md')), null);
});

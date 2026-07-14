'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractImageRefs, collectPromptImages } = require('../src/main/services/agentTools');

test('extracts markdown image links', () => {
  const refs = extractImageRefs('Intro\n![screenshot](images/shot.png)\n![with title](pics/a.jpg "cap")');
  assert.deepStrictEqual(refs, ['images/shot.png', 'pics/a.jpg']);
});

test('extracts bare image paths', () => {
  const refs = extractImageRefs('please analyze ./diagrams/arch.webp and also /tmp/photo.jpeg');
  assert.deepStrictEqual(refs, ['./diagrams/arch.webp', '/tmp/photo.jpeg']);
});

test('extracts inline data URIs', () => {
  const refs = extractImageRefs('here ![x](data:image/png;base64,aGVsbG8=) inline');
  assert.ok(refs.some((r) => r.startsWith('data:image/png;base64,')));
});

test('deduplicates and ignores non-image text', () => {
  const refs = extractImageRefs('![a](x.png) and x.png again, but not notes.md or script.js');
  assert.deepStrictEqual(refs, ['x.png']);
});

test('returns empty for plain prose', () => {
  assert.deepStrictEqual(extractImageRefs('no images here, just text.'), []);
  assert.deepStrictEqual(extractImageRefs(''), []);
});

test('collectPromptImages encodes existing files and skips missing/remote ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vomit-img-'));
  try {
    const imgPath = path.join(dir, 'pic.png');
    fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const text = '![p](pic.png) plus https://example.com/remote.png and ![m](missing.png)';
    const { images, names } = collectPromptImages(text, [dir]);

    assert.strictEqual(images.length, 1);
    assert.strictEqual(names[0], 'pic.png');
    assert.strictEqual(Buffer.from(images[0], 'base64')[0], 0x89);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectPromptImages decodes percent-encoded paths and honors the cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vomit-img-'));
  try {
    fs.writeFileSync(path.join(dir, 'my pic.png'), Buffer.from([1]));
    for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(dir, `i${i}.png`), Buffer.from([i]));

    const spaced = collectPromptImages('![x](my%20pic.png)', [dir]);
    assert.strictEqual(spaced.names[0], 'my pic.png');

    const many = collectPromptImages(
      Array.from({ length: 6 }, (_, i) => `![](i${i}.png)`).join(' '),
      [dir]
    );
    assert.strictEqual(many.images.length, 4); // MAX_PROMPT_IMAGES
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectPromptImages takes base64 from data URIs directly', () => {
  const { images, names } = collectPromptImages('![](data:image/png;base64,aGVsbG8=)', []);
  assert.deepStrictEqual(images, ['aGVsbG8=']);
  assert.strictEqual(names[0], '(inline image)');
});

test('collectPromptImages reports mime types from extension and data URIs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vomit-img-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.png'), Buffer.from([0x89]));
    fs.writeFileSync(path.join(dir, 'b.jpg'), Buffer.from([0xff]));
    const { mimes } = collectPromptImages('![](a.png) and ![](b.jpg)', [dir]);
    assert.deepStrictEqual(mimes, ['image/png', 'image/jpeg']);

    const inline = collectPromptImages('![](data:image/webp;base64,aGk=)', []);
    assert.strictEqual(inline.mimes[0], 'image/webp');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectPromptImages honors an encoder returning {data, mime}', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vomit-img-'));
  try {
    fs.writeFileSync(path.join(dir, 'c.png'), Buffer.from([0x89]));
    const { images, mimes } = collectPromptImages('![](c.png)', [dir], {
      encoder: () => ({ data: 'ZmFrZQ==', mime: 'image/jpeg' })
    });
    assert.deepStrictEqual(images, ['ZmFrZQ==']);
    assert.strictEqual(mimes[0], 'image/jpeg');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

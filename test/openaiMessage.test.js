'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { toOpenAIMessage } = require('../src/main/services/aiProviders');

test('plain text message stays a string', () => {
  const out = toOpenAIMessage({ role: 'user', content: 'hello' });
  assert.deepStrictEqual(out, { role: 'user', content: 'hello' });
});

test('images become image_url content parts with data URIs', () => {
  const out = toOpenAIMessage({
    role: 'user',
    content: 'OCR this',
    images: ['aGk=', 'Ynll'],
    imageMimes: ['image/png', 'image/jpeg'],
  });
  assert.strictEqual(out.role, 'user');
  assert.ok(Array.isArray(out.content));
  assert.deepStrictEqual(out.content[0], { type: 'text', text: 'OCR this' });
  assert.deepStrictEqual(out.content[1], {
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,aGk=' },
  });
  assert.deepStrictEqual(out.content[2], {
    type: 'image_url',
    image_url: { url: 'data:image/jpeg;base64,Ynll' },
  });
});

test('missing mime defaults to image/png', () => {
  const out = toOpenAIMessage({ role: 'user', content: '', images: ['aGk='] });
  assert.strictEqual(out.content.length, 1); // no text part for empty content
  assert.strictEqual(out.content[0].image_url.url, 'data:image/png;base64,aGk=');
});

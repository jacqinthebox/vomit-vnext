'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { splitSlides, parseSlides } = require('../src/renderer/js/slideParser');

test('splits slides with Unix or Windows line endings', () => {
  assert.deepStrictEqual(splitSlides('# One\n---\n# Two'), ['# One', '# Two']);
  assert.deepStrictEqual(splitSlides('# One\r\n---\r\n# Two'), ['# One', '# Two']);
});

test('accepts whitespace around slide and notes markers', () => {
  const slides = parseSlides('# One\n  ---  \n# Two\n  ???  \nSpeaker notes');

  assert.deepStrictEqual(slides, [
    { content: '# One', notes: '' },
    { content: '# Two', notes: 'Speaker notes' },
  ]);
});

test('preserves additional notes markers in speaker notes', () => {
  const slides = parseSlides('# Slide\n???\nFirst\n???\nSecond');

  assert.deepStrictEqual(slides, [{ content: '# Slide', notes: 'First\n???\nSecond' }]);
});

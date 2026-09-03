(function (root, factory) {
  'use strict';

  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SlideParser = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function splitAtMarker(text, marker) {
    const normalized = String(text || '').replace(/\r\n?/g, '\n');
    const pattern = new RegExp(`\\n[\\t ]*${marker}[\\t ]*\\n`);
    return normalized.split(pattern);
  }

  function splitSlides(markdown) {
    return splitAtMarker(String(markdown || '').trim(), '---').filter((slide) => slide.trim());
  }

  function parseSlides(markdown) {
    return splitSlides(markdown).map((slideText) => {
      const parts = splitAtMarker(slideText, '\\?\\?\\?');
      return {
        content: parts[0].trim(),
        notes: parts.length > 1 ? parts.slice(1).join('\n???\n').trim() : '',
      };
    });
  }

  return { splitSlides, parseSlides };
});

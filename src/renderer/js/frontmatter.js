// Shared YAML front matter helpers for the editor, presentation, and
// presenter windows. Loaded as a plain script; exposes window.Frontmatter.
(function () {
  'use strict';

  function stripCr(line) {
    return line.endsWith('\r') ? line.slice(0, -1) : line;
  }

  // Extract a front matter block. The document must open with a `---` line
  // and the block closes at the first line that is exactly `---` or `...`
  // (YAML document markers) — a `---` inside a value no longer counts.
  // Returns { yaml, body } or null when there is no complete block.
  function extract(content) {
    if (typeof content !== 'string') return null;
    const lines = content.split('\n');
    if (stripCr(lines[0]).trim() !== '---') return null;
    for (let i = 1; i < lines.length; i++) {
      const marker = stripCr(lines[i]).trim();
      if (marker === '---' || marker === '...') {
        return {
          yaml: lines.slice(1, i).join('\n'),
          body: lines.slice(i + 1).join('\n'),
        };
      }
    }
    return null;
  }

  // Strip the front matter block, returning only the document body.
  function strip(content) {
    const block = extract(content);
    return block ? block.body : content;
  }

  // Parse top-level `key: value` pairs (theme, font-size, ...) from the
  // front matter block. Returns {} when there is no complete block.
  function parseSettings(content) {
    const block = extract(content);
    if (!block) return {};
    const settings = {};
    block.yaml.split('\n').forEach((line) => {
      const colonIndex = line.indexOf(':');
      if (colonIndex !== -1) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        if (key) settings[key] = value;
      }
    });
    return settings;
  }

  window.Frontmatter = { extract, strip, parseSettings };
})();

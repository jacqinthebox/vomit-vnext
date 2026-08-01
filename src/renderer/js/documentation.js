// Documentation window — renders markdown in preview mode
'use strict';

(function () {
  const contentEl = document.getElementById('documentation-content');

  // Configure marked
  marked.setOptions({
    highlight: function (code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch (e) {}
      }
      return hljs.highlightAuto(code).value;
    },
    breaks: true,
    gfm: true,
  });

  // Process emoji shortcodes
  function processEmoji(text) {
    if (typeof emojiMap !== 'undefined') {
      return text.replace(/:([a-z0-9_+-]+):/gi, (match, name) => {
        return emojiMap[name] || match;
      });
    }
    return text;
  }

  // Render LaTeX math
  function renderMath(element) {
    if (typeof renderMathInElement === 'function') {
      renderMathInElement(element, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
      });
    }
  }

  // Render PlantUML diagrams
  function renderPlantUML(element) {
    if (typeof plantumlEncoder === 'undefined') return;

    const codeBlocks = element.querySelectorAll('pre code.language-plantuml');
    codeBlocks.forEach((block) => {
      const code = block.textContent;
      const encoded = plantumlEncoder.encode(code);
      const img = document.createElement('img');
      img.src = `https://www.plantuml.com/plantuml/svg/${encoded}`;
      img.alt = 'PlantUML diagram';
      img.style.maxWidth = '100%';
      block.parentElement.replaceWith(img);
    });
  }

  // Render markdown content
  function renderContent(markdown) {
    // Process emoji shortcodes
    const processed = processEmoji(markdown);

    // Parse and render markdown
    contentEl.innerHTML = marked.parse(processed);

    // Post-process: LaTeX and PlantUML
    renderMath(contentEl);
    renderPlantUML(contentEl);
  }

  // Listen for content from main process
  window.addEventListener('vomit:load-documentation', (e) => {
    const { content } = e.detail;
    renderContent(content);
  });

  // Listen for theme changes
  window.addEventListener('vomit:set-theme', (e) => {
    const theme = e.detail;
    document.body.className = theme;
  });
})();

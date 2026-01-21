// Presentation View - Simple functional approach (no classes, no 'this' issues)
(function() {
  let slides = [];
  let currentIndex = 0;
  let basePath = null;
  let laserActive = false;

  const slideContent = document.getElementById('slide-content');
  const slideCounter = document.getElementById('slide-counter');
  const laserPointer = document.getElementById('laser-pointer');

  function parseSlides(content) {
    let markdown = content || '';
    if (markdown.startsWith('---')) {
      const endIndex = markdown.indexOf('---', 3);
      if (endIndex !== -1) {
        markdown = markdown.substring(endIndex + 3).trim();
      }
    }
    const slideTexts = markdown.split(/\n---\n/).filter(s => s.trim());
    return slideTexts.map(slideText => {
      const parts = slideText.split(/\n\?\?\?\n/);
      return {
        content: parts[0].trim(),
        notes: parts[1] ? parts[1].trim() : ''
      };
    });
  }

  function renderMarkdown(text) {
    // Replace emoji shortcodes
    if (window.replaceEmojis) {
      text = window.replaceEmojis(text);
    }

    // Pre-process: convert image size syntax ![alt](path =WxH) to HTML
    let processed = text.replace(
      /!\[([^\]]*)\]\(([^)\s]+)\s*=(\d*)x(\d*)\)/g,
      (match, alt, src, width, height) => {
        let style = '';
        if (width) style += `width:${width}px;`;
        if (height) style += `height:${height}px;`;
        let resolvedSrc = src;
        if (basePath && !src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('data:')) {
          resolvedSrc = `file://${basePath}/${src}`;
        }
        return `<img src="${resolvedSrc}" alt="${alt}" style="${style}">`;
      }
    );

    // Also handle regular markdown images without size syntax
    processed = processed.replace(
      /!\[([^\]]*)\]\(([^)\s]+)\)/g,
      (match, alt, src) => {
        if (src.includes('=')) return match;
        let resolvedSrc = src;
        if (basePath && !src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('data:')) {
          resolvedSrc = `file://${basePath}/${src}`;
        }
        return `![${alt}](${resolvedSrc})`;
      }
    );

    if (window.marked) {
      return window.marked.parse(processed);
    }
    return processed
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/^\- (.*$)/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>');
  }

  function render() {
    if (slides.length === 0) {
      slideContent.innerHTML = '<h1>No slides</h1><p>Open a markdown file to start presenting</p>';
      slideCounter.textContent = '0 / 0';
      return;
    }

    const slide = slides[currentIndex];
    slideContent.innerHTML = renderMarkdown(slide.content);
    slideCounter.textContent = `${currentIndex + 1} / ${slides.length}`;

    // Highlight code blocks
    slideContent.querySelectorAll('pre code').forEach(block => {
      if (window.hljs) window.hljs.highlightElement(block);
    });

    // Render LaTeX math
    if (window.renderMathInElement) {
      window.renderMathInElement(slideContent, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false
      });
    }

    // Render PlantUML diagrams
    if (window.plantumlEncoder) {
      slideContent.querySelectorAll('pre code.language-plantuml').forEach((block) => {
        const code = block.textContent;
        const encoded = window.plantumlEncoder.encode(code);
        const img = document.createElement('img');
        img.src = `https://www.plantuml.com/plantuml/svg/${encoded}`;
        img.alt = 'PlantUML diagram';
        img.className = 'plantuml-diagram';
        block.parentElement.replaceWith(img);
      });
    }

    // Check if title slide
    const container = document.getElementById('slide');
    const hasOnlyTitles = slide.content.match(/^#[^#]/) && !slide.content.match(/^[^#\n]/m);
    container.classList.toggle('title-slide', hasOnlyTitles);
  }

  function nextSlide() {
    if (currentIndex < slides.length - 1) {
      currentIndex++;
      render();
    }
  }

  function prevSlide() {
    if (currentIndex > 0) {
      currentIndex--;
      render();
    }
  }

  function goToSlide(index) {
    if (index >= 0 && index < slides.length) {
      currentIndex = index;
      render();
    }
  }

  function parseFrontmatter(content) {
    if (!content.startsWith('---')) return {};
    const endIndex = content.indexOf('---', 3);
    if (endIndex === -1) return {};
    const frontmatter = content.substring(3, endIndex).trim();
    const settings = {};
    frontmatter.split('\n').forEach(line => {
      const colonIndex = line.indexOf(':');
      if (colonIndex !== -1) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        settings[key] = value;
      }
    });
    return settings;
  }

  function applyFrontmatterSettings(content) {
    const settings = parseFrontmatter(content);

    // Apply theme
    if (settings.theme) {
      const theme = settings.theme.toLowerCase();
      const validThemes = ['default', 'dark', 'catppuccin', 'nord', 'solarized', 'light'];
      if (validThemes.includes(theme)) {
        document.body.className = `theme-${theme} presentation`;
      }
    }

    // Apply font-size
    const fontSize = settings['font-size'] || settings.fontSize;
    if (fontSize) {
      const size = parseInt(fontSize, 10);
      if (!isNaN(size) && size >= 6 && size <= 72) {
        document.getElementById('slide-content').style.fontSize = `${size}px`;
      }
    }
  }

  function loadContent(content, newBasePath) {
    if (newBasePath !== undefined) {
      basePath = newBasePath;
    }
    applyFrontmatterSettings(content);
    slides = parseSlides(content);
    currentIndex = Math.min(currentIndex, Math.max(0, slides.length - 1));
    render();
  }

  // Event listeners
  window.addEventListener('vomit:load-presentation', e => {
    const { content, basePath: bp } = e.detail;
    loadContent(content, bp);
  });
  window.addEventListener('vomit:update-content', e => loadContent(e.detail));

  window.addEventListener('vomit:navigate-slide', e => {
    const direction = e.detail;
    if (direction === 'next') nextSlide();
    else if (direction === 'prev') prevSlide();
    else if (direction === 'first') goToSlide(0);
    else if (direction === 'last') goToSlide(slides.length - 1);
  });

  window.addEventListener('vomit:go-to-slide', e => goToSlide(e.detail));

  window.addEventListener('vomit:set-theme', e => {
    document.body.className = `theme-${e.detail} presentation`;
  });

  // Laser pointer
  function toggleLaser() {
    laserActive = !laserActive;
    laserPointer.classList.toggle('active', laserActive);
    document.body.classList.toggle('laser-active', laserActive);
  }

  document.addEventListener('mousemove', e => {
    if (laserActive) {
      laserPointer.style.left = e.clientX + 'px';
      laserPointer.style.top = e.clientY + 'px';
    }
  });

  // Handle external links
  document.addEventListener('click', e => {
    const link = e.target.closest('a');
    if (link && link.href && (link.href.startsWith('http://') || link.href.startsWith('https://'))) {
      e.preventDefault();
      window.vomit.openExternal(link.href);
    }
  });

  // Keyboard controls
  document.addEventListener('keydown', e => {
    switch (e.key) {
      case 'ArrowRight':
      case ' ':
      case 'n':
      case 'N':
        e.preventDefault();
        window.vomit.navigateSlide('next');
        break;
      case 'ArrowLeft':
      case 'p':
      case 'P':
        e.preventDefault();
        window.vomit.navigateSlide('prev');
        break;
      case 'Home':
        e.preventDefault();
        window.vomit.navigateSlide('first');
        break;
      case 'End':
        e.preventDefault();
        window.vomit.navigateSlide('last');
        break;
      case 'l':
      case 'L':
        e.preventDefault();
        toggleLaser();
        break;
    }
  });
})();

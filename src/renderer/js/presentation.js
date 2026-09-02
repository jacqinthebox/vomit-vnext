// Presentation View - Simple functional approach (no classes, no 'this' issues)
(function () {
  // Initialize Mermaid with configurable curve style
  function initMermaid(curve) {
    if (window.mermaid) {
      window.mermaid.initialize({
        startOnLoad: false,
        flowchart: { curve: curve || 'linear' },
        theme: 'dark',
      });
    }
  }

  // Load initial setting
  if (window.vomit && window.vomit.getMermaidCurve) {
    window.vomit.getMermaidCurve().then((curve) => initMermaid(curve));
  } else {
    initMermaid('linear');
  }

  // Listen for curve changes
  window.addEventListener('vomit:mermaid-curve-changed', (e) => {
    initMermaid(e.detail);
    render();
  });

  let slides = [];
  let currentIndex = 0;
  let basePath = null;
  let laserActive = false;

  const slideContent = document.getElementById('slide-content');
  const slideCounter = document.getElementById('slide-counter');
  const laserPointer = document.getElementById('laser-pointer');

  function parseSlides(content) {
    const markdown = window.Frontmatter.strip(content || '').trim();
    const slideTexts = markdown.split(/\n---\n/).filter((s) => s.trim());
    return slideTexts.map((slideText) => {
      const parts = slideText.split(/\n\?\?\?\n/);
      return {
        content: parts[0].trim(),
        notes: parts[1] ? parts[1].trim() : '',
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
        if (
          basePath &&
          !src.startsWith('http') &&
          !src.startsWith('file://') &&
          !src.startsWith('data:')
        ) {
          resolvedSrc = `file://${basePath}/${src}`;
        }
        return `<img src="${resolvedSrc}" alt="${alt}" style="${style}">`;
      },
    );

    // Also handle regular markdown images without size syntax
    processed = processed.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, src) => {
      if (src.includes('=')) return match;
      let resolvedSrc = src;
      if (
        basePath &&
        !src.startsWith('http') &&
        !src.startsWith('file://') &&
        !src.startsWith('data:')
      ) {
        resolvedSrc = `file://${basePath}/${src}`;
      }
      return `![${alt}](${resolvedSrc})`;
    });

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
    slideContent.querySelectorAll('pre code').forEach((block) => {
      if (window.hljs) window.hljs.highlightElement(block);
    });

    // Render LaTeX math
    if (window.renderMathInElement) {
      window.renderMathInElement(slideContent, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
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

    // Render Mermaid diagrams
    if (window.mermaid) {
      const mermaidBlocks = slideContent.querySelectorAll('pre code.language-mermaid');
      if (mermaidBlocks.length > 0) {
        mermaidBlocks.forEach((block, index) => {
          const code = block.textContent;
          const div = document.createElement('div');
          div.className = 'mermaid';
          div.id = `mermaid-presentation-${Date.now()}-${index}`;
          div.textContent = code;
          block.parentElement.replaceWith(div);
        });
        window.mermaid.run({ querySelector: '.mermaid' });
      }
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
    return window.Frontmatter.parseSettings(content);
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
  window.addEventListener('vomit:load-presentation', (e) => {
    const { content, basePath: bp } = e.detail;
    loadContent(content, bp);
  });
  window.addEventListener('vomit:update-content', (e) => loadContent(e.detail));

  window.addEventListener('vomit:navigate-slide', (e) => {
    const direction = e.detail;
    if (direction === 'next') nextSlide();
    else if (direction === 'prev') prevSlide();
    else if (direction === 'first') goToSlide(0);
    else if (direction === 'last') goToSlide(slides.length - 1);
  });

  window.addEventListener('vomit:go-to-slide', (e) => goToSlide(e.detail));

  // Escape arrives via the menu accelerator (never as a renderer keydown):
  // close the zoom overlay if open, otherwise really end the presentation.
  window.addEventListener('vomit:presentation-escape', () => {
    if (zoomIsOpen()) closeZoom();
    else window.vomit.endPresentation();
  });

  window.addEventListener('vomit:set-theme', (e) => {
    document.body.className = `theme-${e.detail} presentation`;
  });

  // Image zoom lightbox: click a slide image to open it full-screen, wheel
  // or +/- to zoom, drag to pan, Esc / click outside / click the image at
  // 1x to close. Slide keys are swallowed while it is open.
  const zoomOverlay = document.getElementById('image-zoom-overlay');
  const zoomImg = document.getElementById('image-zoom-img');
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 8;
  let zoomScale = 1;
  let zoomPanX = 0;
  let zoomPanY = 0;
  let zoomDrag = null;
  let zoomDragMoved = false;

  function applyZoom() {
    zoomImg.style.transform = `translate(${zoomPanX}px, ${zoomPanY}px) scale(${zoomScale})`;
    zoomImg.style.cursor = zoomScale > 1 ? 'grab' : 'zoom-in';
  }

  function setZoomScale(next) {
    zoomScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    if (zoomScale === 1) {
      zoomPanX = 0;
      zoomPanY = 0;
    }
    applyZoom();
  }

  function openZoom(src) {
    zoomImg.src = src;
    zoomScale = 1;
    zoomPanX = 0;
    zoomPanY = 0;
    applyZoom();
    zoomOverlay.classList.add('active');
  }

  function closeZoom() {
    zoomOverlay.classList.remove('active');
    zoomImg.removeAttribute('src');
  }

  function zoomIsOpen() {
    return zoomOverlay.classList.contains('active');
  }

  slideContent.addEventListener('click', (e) => {
    const img = e.target.closest('img');
    if (img && img.src) {
      e.preventDefault();
      openZoom(img.src);
    }
  });

  zoomOverlay.addEventListener('click', (e) => {
    if (zoomDragMoved) return;
    // Click outside closes; click on the image toggles 1x <-> 2x.
    if (e.target !== zoomImg) closeZoom();
    else if (zoomScale === 1) setZoomScale(2);
    else setZoomScale(1);
  });

  zoomOverlay.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      setZoomScale(zoomScale * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
    },
    { passive: false },
  );

  zoomImg.addEventListener('mousedown', (e) => {
    if (zoomScale <= 1) return;
    e.preventDefault();
    zoomDrag = { x: e.clientX - zoomPanX, y: e.clientY - zoomPanY };
    zoomDragMoved = false;
    zoomImg.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!zoomDrag) return;
    zoomPanX = e.clientX - zoomDrag.x;
    zoomPanY = e.clientY - zoomDrag.y;
    zoomDragMoved = true;
    applyZoom();
  });

  document.addEventListener('mouseup', () => {
    if (!zoomDrag) return;
    zoomDrag = null;
    applyZoom();
    // Let the click handler see the drag, then clear the flag.
    setTimeout(() => {
      zoomDragMoved = false;
    }, 0);
  });

  // Laser pointer
  function toggleLaser() {
    laserActive = !laserActive;
    laserPointer.classList.toggle('active', laserActive);
    document.body.classList.toggle('laser-active', laserActive);
  }

  document.addEventListener('mousemove', (e) => {
    if (laserActive) {
      laserPointer.style.left = e.clientX + 'px';
      laserPointer.style.top = e.clientY + 'px';
    }
  });

  // Handle external links
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (
      link &&
      link.href &&
      (link.href.startsWith('http://') || link.href.startsWith('https://'))
    ) {
      e.preventDefault();
      window.vomit.openExternal(link.href);
    }
  });

  // Keyboard controls
  document.addEventListener('keydown', (e) => {
    if (zoomIsOpen()) {
      switch (e.key) {
        case 'Escape':
          closeZoom();
          break;
        case '+':
        case '=':
          setZoomScale(zoomScale * 1.2);
          break;
        case '-':
          setZoomScale(zoomScale / 1.2);
          break;
        case '0':
          setZoomScale(1);
          break;
      }
      e.preventDefault();
      return;
    }
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

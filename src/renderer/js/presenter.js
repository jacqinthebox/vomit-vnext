// Presenter View - Simple functional approach (no classes, no 'this' issues)
(function() {
  let slides = [];
  let currentIndex = 0;
  let startTime = null;
  let timerInterval = null;
  let basePath = null;

  // DOM elements
  const currentSlideEl = document.querySelector('#current-slide .slide-content');
  const nextSlideEl = document.querySelector('#next-slide .slide-content');
  const notesContent = document.getElementById('notes-content');
  const currentNum = document.getElementById('current-num');
  const totalNum = document.getElementById('total-num');
  const elapsedTime = document.getElementById('elapsed-time');

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

  function highlightCode(container) {
    container.querySelectorAll('pre code').forEach(block => {
      if (window.hljs) window.hljs.highlightElement(block);
    });
  }

  function render() {
    // Current slide
    if (slides.length === 0) {
      currentSlideEl.innerHTML = '<h2>No slides</h2>';
      nextSlideEl.innerHTML = '';
      notesContent.innerHTML = '';
      currentNum.textContent = '0';
      totalNum.textContent = '0';
      return;
    }

    const slide = slides[currentIndex];
    currentSlideEl.innerHTML = renderMarkdown(slide.content);
    highlightCode(currentSlideEl);

    // Next slide
    const nextIndex = currentIndex + 1;
    if (nextIndex >= slides.length) {
      nextSlideEl.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">End of presentation</p>';
    } else {
      nextSlideEl.innerHTML = renderMarkdown(slides[nextIndex].content);
      highlightCode(nextSlideEl);
    }

    // Notes
    notesContent.innerHTML = slide.notes ? renderMarkdown(slide.notes) : '';

    // Counter
    currentNum.textContent = currentIndex + 1;
    totalNum.textContent = slides.length;
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

  function loadContent(content, newBasePath) {
    if (newBasePath !== undefined) {
      basePath = newBasePath;
    }
    slides = parseSlides(content);
    currentIndex = Math.min(currentIndex, Math.max(0, slides.length - 1));
    render();
  }

  function updateTimer() {
    if (!startTime) return;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    elapsedTime.textContent = `${minutes}:${seconds}`;
  }

  function resetTimer() {
    startTime = Date.now();
    updateTimer();
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
    document.body.className = `theme-${e.detail} presenter-view`;
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
        window.vomit.goToSlide(0);
        break;
      case 'End':
        e.preventDefault();
        window.vomit.goToSlide(slides.length - 1);
        break;
      case 'r':
      case 'R':
        resetTimer();
        break;
    }
  });

  // Button controls
  document.getElementById('btn-first').addEventListener('click', () => window.vomit.goToSlide(0));
  document.getElementById('btn-prev').addEventListener('click', () => window.vomit.navigateSlide('prev'));
  document.getElementById('btn-next').addEventListener('click', () => window.vomit.navigateSlide('next'));
  document.getElementById('btn-last').addEventListener('click', () => window.vomit.goToSlide(slides.length - 1));

  // Start timer
  startTime = Date.now();
  timerInterval = setInterval(updateTimer, 1000);
})();

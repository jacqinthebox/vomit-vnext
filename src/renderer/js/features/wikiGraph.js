// Wiki graph view — full-vault force-directed graph of notes and wikilinks.
// Lazy-loads vis-network only when the modal opens for the first time.
// Triggered via the View menu (Cmd+Shift+G) or `/wiki graph` (future).
class WikiGraphManager {
  constructor({ state }) {
    this.state = state;
    this.network = null;
    this.modal = document.getElementById('wiki-graph-modal');
    this.canvas = document.getElementById('wiki-graph-canvas');
    this.stats = document.getElementById('wiki-graph-stats');
    this.closeBtn = document.getElementById('wiki-graph-close');
    this.hideOrphansToggle = document.getElementById('wiki-graph-hide-orphans');
    this.panel = this.modal?.querySelector('.wiki-graph-panel');
    this.header = this.panel?.querySelector('.modal-header');
    this.hideOrphans = false;
    try {
      this.hideOrphans = localStorage.getItem('vomit.wikiGraph.hideOrphans') === '1';
    } catch {}
    if (this.hideOrphansToggle) this.hideOrphansToggle.checked = this.hideOrphans;
    this._wire();
    this._setupDragAndResize();
  }

  _wire() {
    if (!this.modal) return;
    this.closeBtn?.addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (e) => {
      // Don't close-on-backdrop if user is mid-drag.
      if (e.target === this.modal && !this._wasDragging) this.close();
      this._wasDragging = false;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
        this.close();
      }
    });
    window.addEventListener('vomit:toggle-wiki-graph', () => this.toggle());
    this.hideOrphansToggle?.addEventListener('change', () => {
      this.hideOrphans = !!this.hideOrphansToggle.checked;
      try {
        localStorage.setItem('vomit.wikiGraph.hideOrphans', this.hideOrphans ? '1' : '0');
      } catch {}
      if (!this.modal.classList.contains('hidden')) this._render();
    });
  }

  _setupDragAndResize() {
    if (!this.panel || !this.header) return;

    // Restore saved geometry.
    let saved = null;
    try {
      const raw = localStorage.getItem('vomit.wikiGraph.geometry');
      if (raw) saved = JSON.parse(raw);
    } catch {}
    if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
      this.panel.style.width = `${saved.w}px`;
      this.panel.style.height = `${saved.h}px`;
    }
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      this.modal.classList.add('is-floating');
      this.panel.style.left = `${saved.x}px`;
      this.panel.style.top = `${saved.y}px`;
    }

    // Drag from header — but ignore drags that start on buttons / inputs.
    let dragging = false;
    let startX = 0,
      startY = 0,
      startLeft = 0,
      startTop = 0;

    this.header.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, input, label')) return;
      // Promote to floating layout on first drag.
      if (!this.modal.classList.contains('is-floating')) {
        const rect = this.panel.getBoundingClientRect();
        this.modal.classList.add('is-floating');
        this.panel.style.left = `${rect.left}px`;
        this.panel.style.top = `${rect.top}px`;
      }
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = parseFloat(this.panel.style.left) || 0;
      startTop = parseFloat(this.panel.style.top) || 0;
      document.body.style.cursor = 'move';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      this._wasDragging = true;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const w = this.panel.offsetWidth;
      const h = this.panel.offsetHeight;
      // Keep at least a sliver on-screen for re-grabbing.
      const newLeft = Math.max(20 - w, Math.min(window.innerWidth - 20, startLeft + dx));
      const newTop = Math.max(0, Math.min(window.innerHeight - 30, startTop + dy));
      this.panel.style.left = `${newLeft}px`;
      this.panel.style.top = `${newTop}px`;
    });

    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        this._persistGeometry();
      }
    });

    // Persist resize (browser native resize). Watch panel size changes.
    if (typeof ResizeObserver !== 'undefined') {
      let resizeTimer = null;
      const ro = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => this._persistGeometry(), 200);
      });
      ro.observe(this.panel);
    }

    // Double-click header to reset to centered default.
    this.header.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, input, label')) return;
      this._resetGeometry();
    });
  }

  _persistGeometry() {
    if (!this.panel) return;
    try {
      const data = {
        w: this.panel.offsetWidth,
        h: this.panel.offsetHeight,
      };
      if (this.modal.classList.contains('is-floating')) {
        data.x = parseFloat(this.panel.style.left) || 0;
        data.y = parseFloat(this.panel.style.top) || 0;
      }
      localStorage.setItem('vomit.wikiGraph.geometry', JSON.stringify(data));
    } catch {}
  }

  _resetGeometry() {
    if (!this.panel) return;
    this.modal.classList.remove('is-floating');
    this.panel.style.left = '';
    this.panel.style.top = '';
    this.panel.style.width = '';
    this.panel.style.height = '';
    try {
      localStorage.removeItem('vomit.wikiGraph.geometry');
    } catch {}
    // Trigger redraw so vis-network re-fits.
    if (this.network) this.network.redraw();
  }

  toggle() {
    if (this.modal.classList.contains('hidden')) this.open();
    else this.close();
  }

  async open() {
    if (!this.modal || !this.canvas) return;
    this.modal.classList.remove('hidden');
    await this._render();
  }

  close() {
    this.modal?.classList.add('hidden');
    if (this.network) {
      this.network.destroy();
      this.network = null;
    }
  }

  async _render() {
    if (typeof vis === 'undefined' || !vis.Network) {
      this.stats.textContent = 'vis-network failed to load.';
      return;
    }
    const bucketRoot = this.state.projectRoot || this.state.currentDirectory;
    if (!bucketRoot) {
      this.stats.textContent = 'No bucket open.';
      return;
    }

    let result;
    try {
      result = await window.vomit.wikiGraph(bucketRoot);
    } catch (err) {
      this.stats.textContent = `Error: ${err.message}`;
      return;
    }
    if (!result || !result.success) {
      this.stats.textContent = result?.error || 'Failed to load graph. Run /wiki reindex.';
      return;
    }

    const rawNodes = result.nodes || [];
    const rawEdges = result.edges || [];

    // "Orphan" = node with no inbound or outbound edges.
    const connected = new Set();
    for (const e of rawEdges) {
      connected.add(e.source);
      connected.add(e.target);
    }
    const orphanCount = rawNodes.reduce((n, x) => n + (connected.has(x.id) ? 0 : 1), 0);
    const filteredNodes = this.hideOrphans ? rawNodes.filter((n) => connected.has(n.id)) : rawNodes;
    const visibleIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = this.hideOrphans
      ? rawEdges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
      : rawEdges;

    const nodes = filteredNodes.map((n) => ({
      id: n.id,
      label: n.title || n.basename,
      title: n.id, // hover tooltip = absolute path
    }));
    const edges = filteredEdges.map((e) => ({
      from: e.source,
      to: e.target,
      arrows: 'to',
    }));

    // Highlight the currently-open file.
    const active = this.state.currentFilePath;
    if (active) {
      const activeNode = nodes.find((n) => n.id === active);
      if (activeNode) {
        activeNode.color = { background: '#ffce46', border: '#e0a800' };
        // Label is drawn on the dark canvas background — keep it readable.
        activeNode.font = { color: '#ffce46', size: 14, face: 'sans-serif', strokeWidth: 0 };
      }
    }

    const orphanNote =
      this.hideOrphans && orphanCount > 0
        ? ` · ${orphanCount} orphan${orphanCount === 1 ? '' : 's'} hidden`
        : '';
    this.stats.textContent = `${nodes.length} notes · ${edges.length} links${orphanNote}`;

    const accent =
      getComputedStyle(document.body).getPropertyValue('--accent-color').trim() || '#4a90d9';
    const muted = getComputedStyle(document.body).getPropertyValue('--text-muted').trim() || '#888';
    const bg = getComputedStyle(document.body).getPropertyValue('--bg-secondary').trim() || '#222';

    const data = {
      nodes: new vis.DataSet(nodes),
      edges: new vis.DataSet(edges),
    };
    const options = {
      autoResize: true,
      interaction: { hover: true, tooltipDelay: 200 },
      nodes: {
        shape: 'dot',
        size: 12,
        color: {
          background: accent,
          border: accent,
          highlight: { background: '#ffce46', border: '#e0a800' },
        },
        font: { color: muted, size: 12, face: 'sans-serif' },
      },
      edges: {
        color: { color: muted, opacity: 0.5 },
        smooth: { type: 'continuous' },
        arrows: { to: { enabled: true, scaleFactor: 0.5 } },
      },
      physics: {
        enabled: true,
        stabilization: { iterations: 150 },
        barnesHut: { gravitationalConstant: -3000, springLength: 95, springConstant: 0.04 },
      },
    };

    if (this.network) this.network.destroy();
    this.network = new vis.Network(this.canvas, data, options);

    // Click → open the note. Double-click also opens (consistent with file tree).
    const openNode = (params) => {
      const nodeId = params.nodes && params.nodes[0];
      if (nodeId) {
        window.vomit.openFile(nodeId);
        this.close();
      }
    };
    this.network.on('click', openNode);
  }
}

window.WikiGraphManager = WikiGraphManager;

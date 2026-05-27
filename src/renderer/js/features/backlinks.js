// Backlinks panel — populates the Backlinks tab of the right sidebar with
// every other note that links to the currently-open file via [[wikilinks]].
// Grouped by source note; click a row to open that source at the link line.
class BacklinksManager {
  constructor({ state, dom, host }) {
    this.state = state;
    this.dom = dom;
    this.host = host;
    this.activeTab = 'outline';
    this._refreshTimer = null;
    this._setupTabs();
    this._wireRefresh();
  }

  _setupTabs() {
    const tabBar = document.querySelector('#right-outline .sidebar-tabs');
    if (!tabBar) return;
    tabBar.addEventListener('click', (e) => {
      const tab = e.target.closest('.sidebar-tab');
      if (!tab) return;
      this.setActiveTab(tab.dataset.tab);
    });
  }

  setActiveTab(name) {
    this.activeTab = name;
    const sidebar = document.getElementById('right-outline');
    if (!sidebar) return;
    sidebar.querySelectorAll('.sidebar-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    sidebar.querySelectorAll('.sidebar-tab-pane').forEach(p => {
      p.classList.toggle('active', p.dataset.pane === name);
    });
    if (name === 'backlinks') {
      this.refresh();
    }
  }

  _wireRefresh() {
    // Debounced refresh when the index changes or the active file changes.
    const schedule = () => {
      if (this._refreshTimer) clearTimeout(this._refreshTimer);
      this._refreshTimer = setTimeout(() => this.refresh(), 250);
    };
    window.addEventListener('vomit:wiki-changed', schedule);
    window.addEventListener('vomit:load-content', schedule);
    if (this.state && typeof this.state.addEventListener === 'function') {
      this.state.addEventListener('change:currentFilePath', schedule);
    }
  }

  async refresh() {
    const list = document.getElementById('right-backlinks-list');
    if (!list) return;
    if (this.activeTab !== 'backlinks') return; // Don't fetch when hidden

    const bucketRoot = this.state.projectRoot || this.state.currentDirectory;
    const filePath = this.state.currentFilePath;
    if (!bucketRoot || !filePath) {
      list.innerHTML = '<div class="backlink-empty">No file open.</div>';
      return;
    }

    try {
      const result = await window.vomit.wikiBacklinks(bucketRoot, filePath);
      if (!result || !result.success) {
        list.innerHTML = '<div class="backlink-empty">Wiki index not built. Run /wiki reindex.</div>';
        return;
      }
      this._render(list, result.backlinks || []);
    } catch (err) {
      list.innerHTML = `<div class="backlink-empty">Error: ${err.message}</div>`;
    }
  }

  _render(container, backlinks) {
    if (backlinks.length === 0) {
      container.innerHTML = '<div class="backlink-empty">No backlinks yet.</div>';
      return;
    }

    // Group by source_path.
    const groups = new Map();
    for (const bl of backlinks) {
      if (!groups.has(bl.source_path)) groups.set(bl.source_path, []);
      groups.get(bl.source_path).push(bl);
    }

    container.innerHTML = '';
    for (const [sourcePath, rows] of groups) {
      const groupEl = document.createElement('div');
      groupEl.className = 'backlink-group';

      const title = rows[0].source_title || rows[0].source_basename || sourcePath;
      const header = document.createElement('div');
      header.className = 'backlink-group-header';
      header.innerHTML = `<span class="backlink-title"></span><span class="backlink-count">${rows.length}</span>`;
      header.querySelector('.backlink-title').textContent = title;
      header.title = sourcePath;
      header.addEventListener('click', () => {
        window.vomit.openFile(sourcePath);
      });
      groupEl.appendChild(header);

      for (const row of rows) {
        const rowEl = document.createElement('div');
        rowEl.className = 'backlink-row';
        rowEl.title = `${sourcePath}:${row.line}`;
        const ctx = document.createElement('span');
        ctx.className = 'backlink-context';
        ctx.textContent = row.context || '';
        rowEl.appendChild(ctx);
        rowEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this._openAtLine(sourcePath, row.line);
        });
        groupEl.appendChild(rowEl);
      }

      container.appendChild(groupEl);
    }
  }

  _openAtLine(filePath, line) {
    // Stash a pending jump that editor.js consumes after load.
    if (this.state) this.state.pendingLineJump = line;
    window.vomit.openFile(filePath);
  }
}

window.BacklinksManager = BacklinksManager;

// FileSearchManager — fuzzy filename search overlay (Cmd+Shift+K).

class FileSearchManager {
  constructor() {
    this._overlay = null;
    this._input = null;
    this._list = null;
    this._files = [];
    this._filtered = [];
    this._selectedIndex = 0;
  }

  setup() {
    const overlay = document.createElement('div');
    overlay.className = 'file-search-overlay hidden';
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });

    const panel = document.createElement('div');
    panel.className = 'file-search-panel';

    const input = document.createElement('input');
    input.className = 'file-search-input';
    input.placeholder = 'Search files by name...';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');

    const list = document.createElement('div');
    list.className = 'file-search-list';

    panel.appendChild(input);
    panel.appendChild(list);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    this._overlay = overlay;
    this._input = input;
    this._list = list;

    input.addEventListener('input', () => this._filter());
    input.addEventListener('keydown', (e) => this._onKeydown(e));
  }

  async open() {
    this._files = (await window.vomit.getAllFiles()) || [];
    this._overlay.classList.remove('hidden');
    this._input.value = '';
    this._filter();
    this._input.focus();
  }

  close() {
    this._overlay.classList.add('hidden');
    document.querySelector('.CodeMirror')?.CodeMirror?.focus();
  }

  toggle() {
    if (this._overlay.classList.contains('hidden')) {
      this.open();
    } else {
      this.close();
    }
  }

  _filter() {
    const q = this._input.value.toLowerCase().trim();
    this._filtered = q
      ? this._files.filter(
          (f) => f.name.toLowerCase().includes(q) || f.relativePath.toLowerCase().includes(q),
        )
      : this._files.slice(0, 50);
    this._selectedIndex = 0;
    this._render();
  }

  _render() {
    if (this._filtered.length === 0) {
      this._list.innerHTML = '<div class="file-search-empty">No matching files</div>';
      return;
    }

    const q = this._input.value.trim();
    const visible = this._filtered.slice(0, 50);
    this._list.innerHTML = visible
      .map((f, i) => {
        const selected = i === this._selectedIndex ? 'selected' : '';
        return `<div class="file-search-item ${selected}" data-path="${f.path}">
          <span class="file-search-name">${this._hl(f.name, q)}</span>
          <span class="file-search-path">${this._hl(f.relativePath, q)}</span>
        </div>`;
      })
      .join('');

    this._list.querySelectorAll('.file-search-item').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        window.vomit.openFile(el.dataset.path);
        this.close();
      });
    });

    const sel = this._list.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  _hl(text, q) {
    if (!q) return this._esc(text);
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return this._esc(text);
    return (
      this._esc(text.slice(0, i)) +
      '<mark>' +
      this._esc(text.slice(i, i + q.length)) +
      '</mark>' +
      this._esc(text.slice(i + q.length))
    );
  }

  _esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  _onKeydown(e) {
    const max = Math.min(this._filtered.length, 50);
    if (e.key === 'Escape') {
      this.close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._selectedIndex = Math.min(this._selectedIndex + 1, max - 1);
      this._render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._selectedIndex = Math.max(this._selectedIndex - 1, 0);
      this._render();
    } else if (e.key === 'Enter') {
      const f = this._filtered[this._selectedIndex];
      if (f) {
        window.vomit.openFile(f.path);
        this.close();
      }
    }
  }
}

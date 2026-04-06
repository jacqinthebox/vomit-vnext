// SearchManager — File search, keyboard navigation, and pane focus toggling.

class SearchManager {
  constructor({ state, host, dom }) {
    this.state = state;
    this.host = host;
    this.dom = dom;  // { searchInput, searchResults, sidebarSearch, sidebarFiles, sidebarOutline, fileTree, outlineList, previewPane }
    this.currentQuery = '';  // Track current search query for highlighting
  }

  setup() {
    // Debounced search on input
    this.dom.searchInput.addEventListener('input', () => {
      clearTimeout(this.state.searchTimeout);
      this.state.selectedSearchIndex = -1;
      this.state.searchTimeout = setTimeout(() => this.performSearch(), 300);
    });

    // Keyboard navigation in search
    this.dom.searchInput.addEventListener('keydown', (e) => {
      const items = this.dom.searchResults.querySelectorAll('.search-result-item');

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.state.selectedSearchIndex = Math.min(this.state.selectedSearchIndex + 1, items.length - 1);
        this.updateSearchSelection(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.state.selectedSearchIndex = Math.max(this.state.selectedSearchIndex - 1, -1);
        this.updateSearchSelection(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.state.selectedSearchIndex >= 0 && items[this.state.selectedSearchIndex]) {
          items[this.state.selectedSearchIndex].click();
        } else {
          clearTimeout(this.state.searchTimeout);
          this.performSearch();
        }
      } else if (e.key === 'Escape') {
        this.toggleSearch();
        this.host.cm.focus();
      }
    });
  }

  updateSearchSelection(items) {
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === this.state.selectedSearchIndex);
    });
    if (this.state.selectedSearchIndex >= 0 && items[this.state.selectedSearchIndex]) {
      const selectedItem = items[this.state.selectedSearchIndex];
      selectedItem.scrollIntoView({ block: 'nearest' });

      // Preview the match in the editor
      const filePath = selectedItem.dataset.path;
      const line = parseInt(selectedItem.dataset.line, 10);
      this.previewMatch(filePath, line);
    }
  }

  previewMatch(filePath, line) {
    // Only preview if it's the current file
    if (filePath !== this.state.currentFilePath) {
      return;
    }

    const lineIndex = line - 1; // CM uses 0-based line numbers
    const lineContent = this.host.getLine(lineIndex);
    if (!lineContent || !this.currentQuery) return;

    // Find the search term on this line (case-insensitive)
    const lowerLine = lineContent.toLowerCase();
    const lowerQuery = this.currentQuery.toLowerCase();
    const matchStart = lowerLine.indexOf(lowerQuery);

    if (matchStart >= 0) {
      const matchEnd = matchStart + this.currentQuery.length;
      // Select the match to highlight it
      this.host.setSelection(
        { line: lineIndex, ch: matchStart },
        { line: lineIndex, ch: matchEnd }
      );
      // Scroll the editor to show the match
      this.host.scrollIntoView({ line: lineIndex, ch: matchStart });
    }
  }

  toggleSearch() {
    this.state.isSearchVisible = !this.state.isSearchVisible;
    this.dom.sidebarSearch.classList.toggle('hidden', !this.state.isSearchVisible);
    this._updateResizeHandle();
    if (this.state.isSearchVisible) {
      // Close other sidebars
      this.state.isFileTreeVisible = false;
      this.state.isOutlineVisible = false;
      this.dom.sidebarFiles.classList.add('hidden');
      this.dom.sidebarOutline.classList.add('hidden');
      this.dom.searchInput.focus();
    }
  }

  async performSearch() {
    const query = this.dom.searchInput.value.trim();
    if (!query || query.length < 2) {
      this.dom.searchResults.innerHTML = '<div class="search-no-results">Type at least 2 characters to search</div>';
      this.currentQuery = '';
      return;
    }

    this.currentQuery = query;  // Store for highlighting

    // Use projectRoot for search (covers entire project), fall back to currentDirectory
    let searchDir = this.state.projectRoot || this.state.currentDirectory;
    if (!searchDir) {
      searchDir = await window.vomit.getCurrentDirectory();
    }

    if (!searchDir) {
      this.dom.searchResults.innerHTML = '<div class="search-no-results">Open a file to search in its directory</div>';
      return;
    }

    const results = await window.vomit.searchInFiles(searchDir, query);
    this.renderSearchResults(results, query);
  }

  renderSearchResults(results, query) {
    this.state.selectedSearchIndex = -1;

    if (!results || results.length === 0) {
      this.dom.searchResults.innerHTML = '<div class="search-no-results">No results found</div>';
      return;
    }

    const html = results.map(file => {
      const matchesHtml = file.matches.map(match => {
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const highlightedText = match.text.replace(
          new RegExp(`(${escapedQuery})`, 'gi'),
          '<span class="match">$1</span>'
        );
        return `<div class="search-result-item" data-path="${file.path}" data-line="${match.line}">
          <span class="line-number">${match.line}:</span>${highlightedText}
        </div>`;
      }).join('');

      return `<div class="search-result-file">${file.file}</div>${matchesHtml}`;
    }).join('');

    this.dom.searchResults.innerHTML = html;

    // Add click handlers
    this.dom.searchResults.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const filePath = el.dataset.path;
        const line = parseInt(el.dataset.line, 10);
        window.vomit.openFile(filePath);
        this.state.pendingLineJump = line;
        this.state.pendingSearchQuery = this.currentQuery;  // Store for highlighting
      });
    });
  }

  togglePaneFocus() {
    const anySidebarOpen = this.state.isFileTreeVisible || this.state.isOutlineVisible || this.state.isSearchVisible;
    const isPreviewOnly = this.state.viewMode === 'preview';

    if (!anySidebarOpen) {
      if (!isPreviewOnly) {
        this.host.cm.focus();
      }
      return;
    }

    if (this.state.focusedPane === 'editor') {
      this.state.focusedPane = 'sidebar';
      if (this.state.isSearchVisible) {
        this.dom.searchInput.focus();
      } else if (this.state.isFileTreeVisible) {
        const firstItem = this.dom.fileTree.querySelector('.file-item');
        if (firstItem) firstItem.focus();
      } else if (this.state.isOutlineVisible) {
        const firstItem = this.dom.outlineList.querySelector('.outline-item');
        if (firstItem) firstItem.focus();
      }
    } else {
      this.state.focusedPane = 'editor';
      if (!isPreviewOnly) {
        this.host.cm.focus();
      } else {
        this.dom.previewPane.focus();
      }
    }
  }

  // Internal helper — keeps resize handle in sync
  _updateResizeHandle() {
    const anySidebarVisible = this.state.isFileTreeVisible || this.state.isOutlineVisible || this.state.isSearchVisible;
    const handle = document.getElementById('sidebar-resize');
    if (handle) handle.classList.toggle('hidden', !anySidebarVisible);
  }
}

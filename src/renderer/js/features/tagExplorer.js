// TagExplorerManager — Sidebar panel showing tags across all documents.
// Scans frontmatter tags and groups documents by tag.

class TagExplorerManager {
  constructor({ state, dom }) {
    this.state = state;
    this.sidebarTags = dom.sidebarTags;
    this.sidebarFiles = dom.sidebarFiles;
    this.sidebarOutline = dom.sidebarOutline;
    this.sidebarSearch = dom.sidebarSearch;
    this.sidebarTodos = dom.sidebarTodos;
    this.sidebarResize = dom.sidebarResize;
    this.tagList = dom.tagList;
    this.expandedTags = new Set();
  }

  toggleTagExplorer() {
    this.state.isTagExplorerVisible = !this.state.isTagExplorerVisible;
    this.sidebarTags.classList.toggle('hidden', !this.state.isTagExplorerVisible);
    this._updateResizeHandle();

    if (this.state.isTagExplorerVisible) {
      // Hide other sidebars
      this.state.isFileTreeVisible = false;
      this.state.isOutlineVisible = false;
      this.state.isSearchVisible = false;
      this.state.isTodoExplorerVisible = false;
      this.sidebarFiles.classList.add('hidden');
      this.sidebarOutline.classList.add('hidden');
      this.sidebarSearch.classList.add('hidden');
      this.sidebarTodos.classList.add('hidden');

      this.loadTags();
    }
  }

  async loadTags() {
    this.tagList.textContent = '';

    const loading = document.createElement('div');
    loading.className = 'tag-no-results';
    loading.textContent = 'Loading tags…';
    this.tagList.appendChild(loading);

    try {
      const result = await window.vomit.getAllTags();
      // Check we're still visible (user may have toggled away)
      if (!this.state.isTagExplorerVisible) return;

      this.tagList.textContent = '';

      if (!result.tags || result.tags.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'tag-no-results';
        empty.textContent = 'No tags found. Add tags: [tag1, tag2] to frontmatter.';
        this.tagList.appendChild(empty);
        return;
      }

      for (const tag of result.tags) {
        this._renderTagGroup(tag);
      }
    } catch (err) {
      this.tagList.textContent = '';
      const errEl = document.createElement('div');
      errEl.className = 'tag-no-results';
      errEl.textContent = 'Failed to load tags.';
      this.tagList.appendChild(errEl);
    }
  }

  _renderTagGroup(tag) {
    const group = document.createElement('div');
    group.className = 'tag-group';

    // Header
    const header = document.createElement('div');
    header.className = 'tag-group-header';

    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4"/></svg>';
    if (this.expandedTags.has(tag.name)) {
      chevron.classList.add('expanded');
    }

    const name = document.createElement('span');
    name.className = 'tag-name';
    name.textContent = tag.name;

    const count = document.createElement('span');
    count.className = 'tag-count';
    count.textContent = `${tag.files.length}`;

    header.appendChild(chevron);
    header.appendChild(name);
    header.appendChild(count);

    // File list container
    const fileList = document.createElement('div');
    fileList.className = 'tag-file-list';
    fileList.style.display = this.expandedTags.has(tag.name) ? 'block' : 'none';

    for (const file of tag.files) {
      const item = document.createElement('div');
      item.className = 'tag-file-item';
      item.textContent = file.name;
      item.title = file.path;
      item.addEventListener('click', () => {
        window.vomit.openFile(file.path);
      });
      fileList.appendChild(item);
    }

    // Toggle expand/collapse
    header.addEventListener('click', () => {
      const isExpanded = this.expandedTags.has(tag.name);
      if (isExpanded) {
        this.expandedTags.delete(tag.name);
        chevron.classList.remove('expanded');
        fileList.style.display = 'none';
      } else {
        this.expandedTags.add(tag.name);
        chevron.classList.add('expanded');
        fileList.style.display = 'block';
      }
    });

    group.appendChild(header);
    group.appendChild(fileList);
    this.tagList.appendChild(group);
  }

  _updateResizeHandle() {
    const anySidebarVisible = this.state.isFileTreeVisible ||
                               this.state.isOutlineVisible ||
                               this.state.isSearchVisible ||
                               this.state.isTagExplorerVisible ||
                               this.state.isTodoExplorerVisible;
    this.sidebarResize.classList.toggle('hidden', !anySidebarVisible);
  }
}

if (typeof window !== 'undefined') {
  window.TagExplorerManager = TagExplorerManager;
}

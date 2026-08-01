// TodoExplorerManager — Sidebar panel showing markdown checkbox todos across a bucket.

class TodoExplorerManager {
  constructor({ state, dom }) {
    this.state = state;
    this.sidebarTodos = dom.sidebarTodos;
    this.sidebarFiles = dom.sidebarFiles;
    this.sidebarOutline = dom.sidebarOutline;
    this.sidebarSearch = dom.sidebarSearch;
    this.sidebarTags = dom.sidebarTags;
    this.sidebarResize = dom.sidebarResize;
    this.todoList = dom.todoList;
    this.expandedSections = new Set(['open']);
    this.expandedFiles = new Set();
    this.refreshTimeout = null;
  }

  toggleTodoExplorer() {
    this.state.isTodoExplorerVisible = !this.state.isTodoExplorerVisible;
    this.sidebarTodos.classList.toggle('hidden', !this.state.isTodoExplorerVisible);
    this._updateResizeHandle();

    if (this.state.isTodoExplorerVisible) {
      this.state.isFileTreeVisible = false;
      this.state.isOutlineVisible = false;
      this.state.isSearchVisible = false;
      this.state.isTagExplorerVisible = false;
      this.sidebarFiles.classList.add('hidden');
      this.sidebarOutline.classList.add('hidden');
      this.sidebarSearch.classList.add('hidden');
      this.sidebarTags.classList.add('hidden');

      this.loadTodos();
    }
  }

  scheduleLoad() {
    if (!this.state.isTodoExplorerVisible) return;
    clearTimeout(this.refreshTimeout);
    this.refreshTimeout = setTimeout(() => this.loadTodos(), 250);
  }

  async loadTodos() {
    this.todoList.textContent = '';

    const loading = document.createElement('div');
    loading.className = 'todo-no-results';
    loading.textContent = 'Loading todos...';
    this.todoList.appendChild(loading);

    try {
      const result = await window.vomit.getAllTodos();
      if (!this.state.isTodoExplorerVisible) return;

      this.todoList.textContent = '';
      const counts = result.counts || { open: 0, done: 0, total: 0 };
      this._renderSummary(counts);

      if (!counts.total) {
        const empty = document.createElement('div');
        empty.className = 'todo-no-results';
        empty.textContent = 'No todos found. Add - [ ] todo items to your notes.';
        this.todoList.appendChild(empty);
        return;
      }

      this._renderSection('open', 'Open', result.open || []);
      this._renderSection('done', 'Done', result.done || []);
    } catch (err) {
      this.todoList.textContent = '';
      const errEl = document.createElement('div');
      errEl.className = 'todo-no-results';
      errEl.textContent = 'Failed to load todos.';
      this.todoList.appendChild(errEl);
    }
  }

  _renderSummary(counts) {
    const summary = document.createElement('div');
    summary.className = 'todo-summary';
    summary.textContent = `${counts.open} open · ${counts.done} done`;
    this.todoList.appendChild(summary);
  }

  _renderSection(id, title, todos) {
    const section = document.createElement('div');
    section.className = 'todo-section';

    const header = document.createElement('div');
    header.className = 'todo-section-header';

    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.innerHTML =
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4"/></svg>';
    if (this.expandedSections.has(id)) chevron.classList.add('expanded');

    const name = document.createElement('span');
    name.className = 'todo-section-title';
    name.textContent = title;

    const count = document.createElement('span');
    count.className = 'todo-count';
    count.textContent = `${todos.length}`;

    header.appendChild(chevron);
    header.appendChild(name);
    header.appendChild(count);

    const body = document.createElement('div');
    body.className = 'todo-section-body';
    body.style.display = this.expandedSections.has(id) ? 'block' : 'none';

    if (todos.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'todo-no-results compact';
      empty.textContent = id === 'open' ? 'Nothing open.' : 'Nothing done yet.';
      body.appendChild(empty);
    } else {
      this._groupByFile(todos).forEach((group) => this._renderFileGroup(body, group));
    }

    header.addEventListener('click', () => {
      if (this.expandedSections.has(id)) {
        this.expandedSections.delete(id);
        chevron.classList.remove('expanded');
        body.style.display = 'none';
      } else {
        this.expandedSections.add(id);
        chevron.classList.add('expanded');
        body.style.display = 'block';
      }
    });

    section.appendChild(header);
    section.appendChild(body);
    this.todoList.appendChild(section);
  }

  _groupByFile(todos) {
    const groups = new Map();
    for (const todo of todos) {
      const key = todo.relativePath || todo.file;
      if (!groups.has(key)) groups.set(key, { file: key, path: todo.path, todos: [] });
      groups.get(key).todos.push(todo);
    }
    return Array.from(groups.values());
  }

  _renderFileGroup(container, group) {
    const fileGroup = document.createElement('div');
    fileGroup.className = 'todo-file-group';

    const header = document.createElement('div');
    header.className = 'todo-file-header';

    const isExpanded = !this.expandedFiles.has(group.file);
    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.innerHTML =
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4"/></svg>';
    if (isExpanded) chevron.classList.add('expanded');

    const name = document.createElement('span');
    name.className = 'todo-file-name';
    name.textContent = group.file;

    const count = document.createElement('span');
    count.className = 'todo-count';
    count.textContent = `${group.todos.length}`;

    header.appendChild(chevron);
    header.appendChild(name);
    header.appendChild(count);

    const items = document.createElement('div');
    items.className = 'todo-file-items';
    items.style.display = isExpanded ? 'block' : 'none';

    for (const todo of group.todos) {
      items.appendChild(this._renderTodoItem(todo));
    }

    header.addEventListener('click', () => {
      const collapsed = this.expandedFiles.has(group.file);
      if (collapsed) {
        this.expandedFiles.delete(group.file);
        chevron.classList.add('expanded');
        items.style.display = 'block';
      } else {
        this.expandedFiles.add(group.file);
        chevron.classList.remove('expanded');
        items.style.display = 'none';
      }
    });

    fileGroup.appendChild(header);
    fileGroup.appendChild(items);
    container.appendChild(fileGroup);
  }

  _renderTodoItem(todo) {
    const item = document.createElement('div');
    item.className = 'todo-item';
    if (todo.checked) item.classList.add('checked');
    item.title = `${todo.relativePath}:${todo.line}`;

    const checkbox = document.createElement('span');
    checkbox.className = 'todo-checkbox';
    checkbox.textContent = todo.checked ? '[x]' : '[ ]';

    const content = document.createElement('div');
    content.className = 'todo-item-content';

    const text = document.createElement('div');
    text.className = 'todo-text';
    text.textContent = todo.text;
    content.appendChild(text);

    const meta = document.createElement('div');
    meta.className = 'todo-meta';

    const line = document.createElement('span');
    line.textContent = `line ${todo.line}`;
    meta.appendChild(line);

    if (todo.due) {
      const due = document.createElement('span');
      due.className = 'todo-badge due';
      due.textContent = todo.due;
      meta.appendChild(due);
    }

    if (todo.priority) {
      const priority = document.createElement('span');
      priority.className = `todo-badge priority-${todo.priority}`;
      priority.textContent = `!${todo.priority}`;
      meta.appendChild(priority);
    }

    for (const tag of todo.tags || []) {
      const tagBadge = document.createElement('span');
      tagBadge.className = 'todo-badge tag';
      tagBadge.textContent = `#${tag}`;
      meta.appendChild(tagBadge);
    }

    content.appendChild(meta);
    item.appendChild(checkbox);
    item.appendChild(content);

    item.addEventListener('click', () => {
      this.state.pendingLineJump = todo.line;
      this.state.pendingSearchQuery = null;
      window.vomit.openFile(todo.path);
    });

    return item;
  }

  _updateResizeHandle() {
    const anySidebarVisible =
      this.state.isFileTreeVisible ||
      this.state.isOutlineVisible ||
      this.state.isSearchVisible ||
      this.state.isTagExplorerVisible ||
      this.state.isTodoExplorerVisible;
    this.sidebarResize.classList.toggle('hidden', !anySidebarVisible);
  }
}

if (typeof window !== 'undefined') {
  window.TodoExplorerManager = TodoExplorerManager;
}

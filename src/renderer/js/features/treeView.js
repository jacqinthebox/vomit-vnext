// TreeView - DOM rendering layer for file tree
// Subscribes to TreeState and TreeDataModel events
// Only updates DOM for what changed - no full rebuilds

class TreeView {
  #container;
  #dataModel;
  #state;
  #elements = new Map();  // path -> DOM element
  #childContainers = new Map(); // path -> children container element

  // SVG for chevron
  static CHEVRON_SVG = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4"/></svg>`;

  constructor(container, dataModel, state) {
    this.#container = container;
    this.#dataModel = dataModel;
    this.#state = state;

    this.#subscribeToEvents();
  }

  // ─────────────────────────────────────────────────────────────
  // Event subscriptions
  // ─────────────────────────────────────────────────────────────

  #subscribeToEvents() {
    // State events
    this.#state.addEventListener('rootChanged', () => this.#onRootChanged());
    this.#state.addEventListener('expand', (e) => this.#onExpand(e.detail));
    this.#state.addEventListener('collapse', (e) => this.#onCollapse(e.detail));
    this.#state.addEventListener('focusChanged', (e) => this.#onFocusChanged(e.detail));
    this.#state.addEventListener('selectionChanged', (e) => this.#onSelectionChanged(e.detail));

    // Data model events
    this.#dataModel.addEventListener('rootChanged', () => this.#onRootChanged());
    this.#dataModel.addEventListener('childrenLoaded', (e) => this.#onChildrenLoaded(e.detail));
    this.#dataModel.addEventListener('nodeAdded', (e) => this.#onNodeAdded(e.detail));
    this.#dataModel.addEventListener('nodeRemoved', (e) => this.#onNodeRemoved(e.detail));
    this.#dataModel.addEventListener('nodeRenamed', (e) => this.#onNodeRenamed(e.detail));
    this.#dataModel.addEventListener('nodeMoved', (e) => this.#onNodeMoved(e.detail));
  }

  // ─────────────────────────────────────────────────────────────
  // State event handlers
  // ─────────────────────────────────────────────────────────────

  #onRootChanged() {
    // Clear everything
    this.#container.innerHTML = '';
    this.#elements.clear();
    this.#childContainers.clear();
  }

  #onExpand(path) {
    const el = this.#elements.get(path);
    if (el) {
      el.classList.add('expanded');
    }

    // If children already loaded, render them
    if (this.#dataModel.hasChildren(path)) {
      this.#renderChildrenOf(path);
    }
    // Otherwise, TreeDataModel.loadChildren will be called, which fires childrenLoaded
  }

  #onCollapse(path) {
    const el = this.#elements.get(path);
    if (el) {
      el.classList.remove('expanded');
    }

    // Remove children from DOM
    const childContainer = this.#childContainers.get(path);
    if (childContainer) {
      // Remove all child elements from our maps
      this.#removeChildElementsFromMaps(path);
      childContainer.remove();
      this.#childContainers.delete(path);
    }
  }

  #onFocusChanged({ old: oldPath, new: newPath }) {
    // Remove focus from old element
    if (oldPath) {
      const oldEl = this.#elements.get(oldPath);
      if (oldEl) {
        oldEl.classList.remove('focused');
      }
    }

    // Add focus to new element
    if (newPath) {
      const newEl = this.#elements.get(newPath);
      if (newEl) {
        newEl.classList.add('focused');
        newEl.focus();
        newEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  #onSelectionChanged({ old: oldPath, new: newPath }) {
    // Remove selection from old element
    if (oldPath) {
      const oldEl = this.#elements.get(oldPath);
      if (oldEl) {
        oldEl.classList.remove('active');
      }
    }

    // Add selection to new element
    if (newPath) {
      const newEl = this.#elements.get(newPath);
      if (newEl) {
        newEl.classList.add('active');
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Data event handlers
  // ─────────────────────────────────────────────────────────────

  #onChildrenLoaded(parentPath) {
    // Only render if parent is expanded
    if (this.#state.isExpanded(parentPath) || parentPath === this.#state.rootPath) {
      this.#renderChildrenOf(parentPath);
    }
  }

  #onNodeAdded(path) {
    const node = this.#dataModel.getNode(path);
    if (!node) return;

    const parentPath = node.parentPath;

    // Find where to insert
    let container;
    if (parentPath === this.#state.rootPath || !parentPath) {
      container = this.#container;
    } else {
      container = this.#childContainers.get(parentPath);
    }

    if (!container) return;

    // Calculate depth
    const depth = this.#calculateDepth(path);

    // Create element
    const el = this.#createNodeElement(node, depth);

    // Find correct position (sorted)
    const siblings = Array.from(container.querySelectorAll(':scope > .file-item'));
    const insertBefore = siblings.find(sibling => {
      const siblingPath = sibling.dataset.path;
      const siblingNode = this.#dataModel.getNode(siblingPath);
      if (!siblingNode) return false;

      // Directories before files
      if (node.isDirectory && !siblingNode.isDirectory) return true;
      if (!node.isDirectory && siblingNode.isDirectory) return false;

      return node.name.localeCompare(siblingNode.name) < 0;
    });

    if (insertBefore) {
      container.insertBefore(el, insertBefore);
    } else {
      // Find first child container (tree-children) and insert before it, or append
      const firstChildContainer = container.querySelector(':scope > .tree-children');
      if (firstChildContainer) {
        container.insertBefore(el, firstChildContainer);
      } else {
        container.appendChild(el);
      }
    }

    this.#elements.set(path, el);
  }

  #onNodeRemoved(path) {
    const el = this.#elements.get(path);
    if (el) {
      el.remove();
      this.#elements.delete(path);
    }

    // Remove child container if exists
    const childContainer = this.#childContainers.get(path);
    if (childContainer) {
      childContainer.remove();
      this.#childContainers.delete(path);
    }
  }

  #onNodeRenamed({ oldPath, newPath }) {
    // Update element
    const el = this.#elements.get(oldPath);
    if (el) {
      const node = this.#dataModel.getNode(newPath);
      if (node) {
        el.dataset.path = newPath;
        el.querySelector('.name').textContent = node.name;
      }
      this.#elements.delete(oldPath);
      this.#elements.set(newPath, el);
    }

    // Update child container reference
    const childContainer = this.#childContainers.get(oldPath);
    if (childContainer) {
      childContainer.dataset.parentPath = newPath;
      this.#childContainers.delete(oldPath);
      this.#childContainers.set(newPath, childContainer);
    }
  }

  #onNodeMoved({ oldPath, newPath, oldParentPath, newParentPath }) {
    // Remove old element and its children from DOM
    const el = this.#elements.get(oldPath);
    if (el) {
      el.remove();
      this.#elements.delete(oldPath);
    }

    // Remove old child container if exists
    const oldChildContainer = this.#childContainers.get(oldPath);
    if (oldChildContainer) {
      // Clean up all child elements from maps
      this.#removeChildElementsFromMaps(oldPath);
      oldChildContainer.remove();
      this.#childContainers.delete(oldPath);
    }

    // Re-render in new location (if new parent is expanded or is root)
    if (this.#state.isExpanded(newParentPath) || newParentPath === this.#state.rootPath) {
      const node = this.#dataModel.getNode(newPath);
      if (node) {
        // Calculate new depth
        const depth = this.#calculateDepth(newPath);

        // Create new element
        const newEl = this.#createNodeElement(node, depth);

        // Find the container to insert into
        let container;
        if (newParentPath === this.#state.rootPath || !newParentPath) {
          container = this.#container;
        } else {
          container = this.#childContainers.get(newParentPath);
        }

        if (container) {
          // Find correct position (sorted)
          const siblings = Array.from(container.querySelectorAll(':scope > .file-item'));
          const insertBefore = siblings.find(sibling => {
            const siblingPath = sibling.dataset.path;
            const siblingNode = this.#dataModel.getNode(siblingPath);
            if (!siblingNode) return false;

            // Directories before files
            if (node.isDirectory && !siblingNode.isDirectory) return true;
            if (!node.isDirectory && siblingNode.isDirectory) return false;

            return node.name.localeCompare(siblingNode.name) < 0;
          });

          if (insertBefore) {
            container.insertBefore(newEl, insertBefore);
          } else {
            const firstChildContainer = container.querySelector(':scope > .tree-children');
            if (firstChildContainer) {
              container.insertBefore(newEl, firstChildContainer);
            } else {
              container.appendChild(newEl);
            }
          }

          this.#elements.set(newPath, newEl);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Rendering helpers
  // ─────────────────────────────────────────────────────────────

  #renderChildrenOf(parentPath) {
    const children = this.#dataModel.getChildren(parentPath);
    if (!children.length) return;

    // Find or create container
    let container;
    if (parentPath === this.#state.rootPath || !parentPath) {
      container = this.#container;
    } else {
      const parentEl = this.#elements.get(parentPath);
      if (!parentEl) return;

      // Check for existing child container
      container = this.#childContainers.get(parentPath);
      if (!container) {
        container = document.createElement('div');
        container.className = 'tree-children expanded';
        container.dataset.parentPath = parentPath;
        parentEl.after(container);
        this.#childContainers.set(parentPath, container);
      }
    }

    // Clear existing children in container (but keep the container)
    const existingItems = container.querySelectorAll(':scope > .file-item');
    existingItems.forEach(item => {
      this.#elements.delete(item.dataset.path);
      item.remove();
    });

    // Calculate depth
    const depth = this.#calculateDepth(parentPath) + 1;

    // Render children
    for (const child of children) {
      const el = this.#createNodeElement(child, depth);
      container.appendChild(el);
      this.#elements.set(child.path, el);

      // If this child is expanded and has loaded children, render them too
      if (child.isDirectory && this.#state.isExpanded(child.path) && this.#dataModel.hasChildren(child.path)) {
        this.#renderChildrenOf(child.path);
      }
    }
  }

  #createNodeElement(node, depth) {
    const isExpanded = this.#state.isExpanded(node.path);
    const isSelected = this.#state.selectedPath === node.path;
    const isFocused = this.#state.focusedPath === node.path;
    const indent = depth * 16;

    const el = document.createElement('div');
    el.className = `file-item${node.isDirectory ? ' directory' : ''}${node.isMarkdown ? ' markdown' : ''}${isSelected ? ' active' : ''}${isExpanded ? ' expanded' : ''}${isFocused ? ' focused' : ''}`;
    el.dataset.path = node.path;
    el.dataset.isDir = node.isDirectory;
    el.dataset.depth = depth;
    el.tabIndex = 0;
    el.style.paddingLeft = `${8 + indent}px`;
    el.innerHTML = `
      <span class="chevron">${TreeView.CHEVRON_SVG}</span>
      <span class="icon"></span>
      <span class="name">${node.name}</span>
    `;

    return el;
  }

  #calculateDepth(path) {
    if (!path || path === this.#state.rootPath) return -1;

    const rootPath = this.#state.rootPath;
    if (!rootPath || !path.startsWith(rootPath)) return 0;

    const relativePath = path.slice(rootPath.length);
    return relativePath.split('/').filter(Boolean).length - 1;
  }

  #removeChildElementsFromMaps(parentPath) {
    const childContainer = this.#childContainers.get(parentPath);
    if (!childContainer) return;

    const allItems = childContainer.querySelectorAll('.file-item');
    allItems.forEach(item => {
      const path = item.dataset.path;
      this.#elements.delete(path);
      this.#childContainers.delete(path);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Public methods for inline editing
  // ─────────────────────────────────────────────────────────────

  getElement(path) {
    return this.#elements.get(path);
  }

  getContainer() {
    return this.#container;
  }

  getChildContainer(parentPath) {
    if (parentPath === this.#state.rootPath || !parentPath) {
      return this.#container;
    }
    return this.#childContainers.get(parentPath);
  }

  // Create or get child container (for inline input insertion)
  ensureChildContainer(parentPath) {
    if (parentPath === this.#state.rootPath || !parentPath) {
      return this.#container;
    }

    let container = this.#childContainers.get(parentPath);
    if (!container) {
      const parentEl = this.#elements.get(parentPath);
      if (!parentEl) return this.#container;

      container = document.createElement('div');
      container.className = 'tree-children expanded';
      container.dataset.parentPath = parentPath;
      parentEl.after(container);
      this.#childContainers.set(parentPath, container);
    }
    return container;
  }
}

// Export for use in renderer
if (typeof window !== 'undefined') {
  window.TreeView = TreeView;
}

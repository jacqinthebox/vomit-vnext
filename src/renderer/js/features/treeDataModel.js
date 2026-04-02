// TreeDataModel - Pure data layer for file tree
// No DOM references, just data and events
// Follows VS Code TreeDataProvider pattern

class TreeDataModel extends EventTarget {
  #nodes = new Map();      // path -> { name, path, isDirectory, isMarkdown, parentPath }
  #children = new Map();   // path -> [childPaths]
  #rootPath = null;
  #loadingPaths = new Set(); // Prevent duplicate loads

  // ─────────────────────────────────────────────────────────────
  // Root management
  // ─────────────────────────────────────────────────────────────

  get rootPath() { return this.#rootPath; }

  setRoot(path) {
    this.#rootPath = path;
    this.#nodes.clear();
    this.#children.clear();
    this.#loadingPaths.clear();
    this.dispatchEvent(new CustomEvent('rootChanged', { detail: path }));
  }

  // ─────────────────────────────────────────────────────────────
  // Data access
  // ─────────────────────────────────────────────────────────────

  getNode(path) {
    return this.#nodes.get(path);
  }

  getChildren(parentPath) {
    const childPaths = this.#children.get(parentPath) || [];
    return childPaths.map(p => this.#nodes.get(p)).filter(Boolean);
  }

  hasChildren(path) {
    return this.#children.has(path);
  }

  getParentPath(path) {
    const node = this.#nodes.get(path);
    return node?.parentPath || null;
  }

  // ─────────────────────────────────────────────────────────────
  // Data loading (from IPC)
  // ─────────────────────────────────────────────────────────────

  async loadChildren(parentPath) {
    // Prevent duplicate concurrent loads
    if (this.#loadingPaths.has(parentPath)) {
      return;
    }

    this.#loadingPaths.add(parentPath);
    this.dispatchEvent(new CustomEvent('loadingStarted', { detail: parentPath }));

    try {
      const items = await window.vomit.getDirectoryContents(parentPath);

      // Store children paths
      const childPaths = items.map(item => item.path);
      this.#children.set(parentPath, childPaths);

      // Store each node
      for (const item of items) {
        this.#nodes.set(item.path, {
          name: item.name,
          path: item.path,
          isDirectory: item.isDirectory,
          isMarkdown: item.isMarkdown,
          parentPath: parentPath
        });
      }

      this.dispatchEvent(new CustomEvent('childrenLoaded', { detail: parentPath }));
    } catch (err) {
      console.error('Failed to load children:', err);
      this.dispatchEvent(new CustomEvent('loadingFailed', { detail: { path: parentPath, error: err } }));
    } finally {
      this.#loadingPaths.delete(parentPath);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Data mutations (after file operations)
  // ─────────────────────────────────────────────────────────────

  addNode(path, node) {
    this.#nodes.set(path, {
      name: node.name,
      path: path,
      isDirectory: node.isDirectory,
      isMarkdown: node.isMarkdown || (!node.isDirectory && (path.endsWith('.md') || path.endsWith('.markdown'))),
      parentPath: node.parentPath
    });

    // Add to parent's children
    const parentPath = node.parentPath;
    if (parentPath) {
      const siblings = this.#children.get(parentPath) || [];
      if (!siblings.includes(path)) {
        siblings.push(path);
        // Sort: directories first, then alphabetically
        siblings.sort((a, b) => {
          const aNode = this.#nodes.get(a);
          const bNode = this.#nodes.get(b);
          if (aNode?.isDirectory && !bNode?.isDirectory) return -1;
          if (!aNode?.isDirectory && bNode?.isDirectory) return 1;
          return (aNode?.name || '').localeCompare(bNode?.name || '');
        });
        this.#children.set(parentPath, siblings);
      }
    }

    this.dispatchEvent(new CustomEvent('nodeAdded', { detail: path }));
  }

  removeNode(path) {
    const node = this.#nodes.get(path);
    if (!node) return;

    // Remove from parent's children
    const parentPath = node.parentPath;
    if (parentPath) {
      const siblings = this.#children.get(parentPath) || [];
      const idx = siblings.indexOf(path);
      if (idx !== -1) {
        siblings.splice(idx, 1);
        this.#children.set(parentPath, siblings);
      }
    }

    // Remove this node and all descendants
    this.#removeNodeAndDescendants(path);

    this.dispatchEvent(new CustomEvent('nodeRemoved', { detail: path }));
  }

  #removeNodeAndDescendants(path) {
    // Remove children recursively
    const childPaths = this.#children.get(path) || [];
    for (const childPath of childPaths) {
      this.#removeNodeAndDescendants(childPath);
    }

    // Remove from maps
    this.#nodes.delete(path);
    this.#children.delete(path);
  }

  renameNode(oldPath, newPath, newName) {
    const node = this.#nodes.get(oldPath);
    if (!node) return;

    // Update node
    const updatedNode = {
      ...node,
      name: newName,
      path: newPath
    };

    // Remove old, add new
    this.#nodes.delete(oldPath);
    this.#nodes.set(newPath, updatedNode);

    // Update parent's children list
    const parentPath = node.parentPath;
    if (parentPath) {
      const siblings = this.#children.get(parentPath) || [];
      const idx = siblings.indexOf(oldPath);
      if (idx !== -1) {
        siblings[idx] = newPath;
        // Re-sort
        siblings.sort((a, b) => {
          const aNode = this.#nodes.get(a);
          const bNode = this.#nodes.get(b);
          if (aNode?.isDirectory && !bNode?.isDirectory) return -1;
          if (!aNode?.isDirectory && bNode?.isDirectory) return 1;
          return (aNode?.name || '').localeCompare(bNode?.name || '');
        });
        this.#children.set(parentPath, siblings);
      }
    }

    this.dispatchEvent(new CustomEvent('nodeRenamed', { detail: { oldPath, newPath } }));
  }

  // Invalidate cached children (force re-fetch on next expand)
  invalidateChildren(path) {
    this.#children.delete(path);
    this.dispatchEvent(new CustomEvent('childrenInvalidated', { detail: path }));
  }

  // ─────────────────────────────────────────────────────────────
  // Navigation helpers
  // ─────────────────────────────────────────────────────────────

  // Get all visible paths in tree order (for keyboard navigation)
  getVisiblePaths(expandedPaths) {
    const result = [];
    this.#collectVisiblePaths(this.#rootPath, expandedPaths, result);
    return result;
  }

  #collectVisiblePaths(parentPath, expandedPaths, result) {
    const children = this.getChildren(parentPath);
    for (const child of children) {
      result.push(child.path);
      if (child.isDirectory && expandedPaths.has(child.path)) {
        this.#collectVisiblePaths(child.path, expandedPaths, result);
      }
    }
  }

  // Get next/previous sibling
  getSibling(path, direction) {
    const node = this.#nodes.get(path);
    if (!node) return null;

    const parentPath = node.parentPath || this.#rootPath;
    const siblings = this.#children.get(parentPath) || [];
    const idx = siblings.indexOf(path);

    if (direction === 'next' && idx < siblings.length - 1) {
      return siblings[idx + 1];
    }
    if (direction === 'prev' && idx > 0) {
      return siblings[idx - 1];
    }
    return null;
  }
}

// Export for use in renderer
if (typeof window !== 'undefined') {
  window.TreeDataModel = TreeDataModel;
}

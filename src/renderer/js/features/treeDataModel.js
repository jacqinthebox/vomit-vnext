// TreeDataModel - Pure data layer for file tree
// No DOM references, just data and events
// Follows VS Code TreeDataProvider pattern

class TreeDataModel extends EventTarget {
  #nodes = new Map();      // path -> { name, path, isDirectory, isMarkdown, parentPath }
  #children = new Map();   // path -> [childPaths]
  #rootPath = null;
  #loadingPaths = new Set(); // Prevent duplicate concurrent loads
  #dirtyPaths = new Set();   // Paths invalidated while a load was in flight

  // ─────────────────────────────────────────────────────────────
  // Root management
  // ─────────────────────────────────────────────────────────────

  get rootPath() { return this.#rootPath; }

  setRoot(path) {
    this.#rootPath = path;
    this.#nodes.clear();
    this.#children.clear();
    this.#loadingPaths.clear();
    this.#dirtyPaths.clear();
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
    this.#dirtyPaths.delete(parentPath); // consume any pending dirty marker
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
      // If invalidated while this load was in flight, reload with fresh data
      if (this.#dirtyPaths.has(parentPath)) {
        this.#dirtyPaths.delete(parentPath);
        this.loadChildren(parentPath);
      }
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

  // Invalidate cached children (force re-fetch on next expand/refresh)
  invalidateChildren(path) {
    this.#children.delete(path);
    // If a load is in flight, mark dirty so it re-fetches once the current load finishes
    if (this.#loadingPaths.has(path)) {
      this.#dirtyPaths.add(path);
    }
    this.dispatchEvent(new CustomEvent('childrenInvalidated', { detail: path }));
  }

  // Move a node to a new parent directory
  moveNode(oldPath, newPath, newParentPath) {
    const node = this.#nodes.get(oldPath);
    if (!node) return;

    const oldParentPath = node.parentPath;

    // Remove from old parent's children list
    if (oldParentPath) {
      const oldSiblings = this.#children.get(oldParentPath) || [];
      const idx = oldSiblings.indexOf(oldPath);
      if (idx !== -1) {
        oldSiblings.splice(idx, 1);
        this.#children.set(oldParentPath, oldSiblings);
      }
    }

    // Update node with new path and parent
    const updatedNode = {
      ...node,
      path: newPath,
      parentPath: newParentPath
    };

    // Remove old, add new
    this.#nodes.delete(oldPath);
    this.#nodes.set(newPath, updatedNode);

    // Add to new parent's children list
    const newSiblings = this.#children.get(newParentPath) || [];
    if (!newSiblings.includes(newPath)) {
      newSiblings.push(newPath);
      // Sort: directories first, then alphabetically
      newSiblings.sort((a, b) => {
        const aNode = this.#nodes.get(a);
        const bNode = this.#nodes.get(b);
        if (aNode?.isDirectory && !bNode?.isDirectory) return -1;
        if (!aNode?.isDirectory && bNode?.isDirectory) return 1;
        return (aNode?.name || '').localeCompare(bNode?.name || '');
      });
      this.#children.set(newParentPath, newSiblings);
    }

    // If this is a directory, update all descendants' paths
    if (node.isDirectory) {
      this.#updateDescendantPaths(oldPath, newPath);
    }

    this.dispatchEvent(new CustomEvent('nodeMoved', {
      detail: { oldPath, newPath, oldParentPath, newParentPath }
    }));
  }

  #updateDescendantPaths(oldBasePath, newBasePath) {
    // Update children paths for this node
    const oldChildPaths = this.#children.get(oldBasePath);
    if (oldChildPaths) {
      const newChildPaths = oldChildPaths.map(childPath => {
        const relativePath = childPath.slice(oldBasePath.length);
        return newBasePath + relativePath;
      });

      this.#children.delete(oldBasePath);
      this.#children.set(newBasePath, newChildPaths);

      // Update each child node
      for (let i = 0; i < oldChildPaths.length; i++) {
        const oldChildPath = oldChildPaths[i];
        const newChildPath = newChildPaths[i];

        const childNode = this.#nodes.get(oldChildPath);
        if (childNode) {
          this.#nodes.delete(oldChildPath);
          this.#nodes.set(newChildPath, {
            ...childNode,
            path: newChildPath,
            parentPath: newBasePath
          });

          // Recursively update if this child is also a directory
          if (childNode.isDirectory) {
            this.#updateDescendantPaths(oldChildPath, newChildPath);
          }
        }
      }
    }
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

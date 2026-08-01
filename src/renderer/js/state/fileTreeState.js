// TreeState - UI state for the file tree with event notifications
// Follows VS Code pattern: state changes emit events, view subscribes

class TreeState extends EventTarget {
  #expandedPaths = new Set();
  #focusedPath = null;
  #selectedPath = null;
  #rootPath = null;

  // ─────────────────────────────────────────────────────────────
  // Root path
  // ─────────────────────────────────────────────────────────────

  get rootPath() {
    return this.#rootPath;
  }

  setRoot(path) {
    const old = this.#rootPath;
    this.#rootPath = path;
    // Clear expansion state when changing roots
    this.#expandedPaths.clear();
    this.#focusedPath = null;
    this.#selectedPath = null;
    this.dispatchEvent(new CustomEvent('rootChanged', { detail: { old, new: path } }));
  }

  // ─────────────────────────────────────────────────────────────
  // Expansion state
  // ─────────────────────────────────────────────────────────────

  isExpanded(path) {
    return this.#expandedPaths.has(path);
  }

  expand(path) {
    if (this.#expandedPaths.has(path)) return; // No-op if already expanded
    this.#expandedPaths.add(path);
    this.dispatchEvent(new CustomEvent('expand', { detail: path }));
  }

  collapse(path) {
    if (!this.#expandedPaths.has(path)) return; // No-op if already collapsed
    this.#expandedPaths.delete(path);
    this.dispatchEvent(new CustomEvent('collapse', { detail: path }));
  }

  toggleExpanded(path) {
    if (this.isExpanded(path)) {
      this.collapse(path);
    } else {
      this.expand(path);
    }
  }

  getExpandedPaths() {
    return new Set(this.#expandedPaths);
  }

  // ─────────────────────────────────────────────────────────────
  // Focus state (keyboard navigation position)
  // ─────────────────────────────────────────────────────────────

  get focusedPath() {
    return this.#focusedPath;
  }

  set focusedPath(path) {
    const old = this.#focusedPath;
    if (old === path) return; // No-op if same
    this.#focusedPath = path;
    this.dispatchEvent(
      new CustomEvent('focusChanged', {
        detail: { old, new: path },
      }),
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Selection state (active file)
  // ─────────────────────────────────────────────────────────────

  get selectedPath() {
    return this.#selectedPath;
  }

  set selectedPath(path) {
    const old = this.#selectedPath;
    if (old === path) return; // No-op if same
    this.#selectedPath = path;
    this.dispatchEvent(
      new CustomEvent('selectionChanged', {
        detail: { old, new: path },
      }),
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Convenience methods
  // ─────────────────────────────────────────────────────────────

  // Focus and select a path (common operation)
  focusAndSelect(path) {
    this.focusedPath = path;
    this.selectedPath = path;
  }

  // Clear focus and selection
  clear() {
    this.focusedPath = null;
    this.selectedPath = null;
  }

  // Ensure all ancestors of a path are expanded (for revealing a node)
  expandAncestors(path) {
    if (!this.#rootPath || !window.PathUtils.isSubPath(path, this.#rootPath)) return;

    const parts = window.PathUtils.relativeParts(path, this.#rootPath);
    let currentPath = this.#rootPath;

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = window.PathUtils.join(currentPath, parts[i]);
      this.expand(currentPath);
    }
  }
}

// Export for use in renderer
if (typeof window !== 'undefined') {
  window.TreeState = TreeState;
}

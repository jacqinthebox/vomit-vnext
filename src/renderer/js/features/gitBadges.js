// GitBadgesManager — git status badges in the file tree.
//
// Pulls `git status --porcelain` results from the main process (git-status
// IPC), caches them, and toggles git-* classes on tree rows incrementally
// via TreeView.getElement(path). Folders inherit a 'modified' badge when any
// descendant is dirty. Inert when the open folder is not a git repo.

const GIT_BADGE_CLASSES = ['git-modified', 'git-untracked', 'git-staged'];

class GitBadgesManager {
  constructor({ treeView, dataModel }) {
    this.treeView = treeView;
    this.dataModel = dataModel;
    this._cache = null; // { files: {absPath: status}, folders: {absPath: 'modified'} }
    this._badged = new Set(); // paths badged in the last apply pass
    this._inFlight = false;
    this._dirty = false;

    // Status actually changed (commit, save, agent write, focus, external).
    window.addEventListener('vomit:git-status-changed', () => this.refresh());
    window.addEventListener('vomit:file-saved', () => this.refresh());
    window.addEventListener('vomit:file-saved-as', () => this.refresh());
    window.addEventListener('vomit:open-folder', () => this.refresh());

    // Tree re-rendered — re-apply the existing cache to the new DOM.
    window.addEventListener('vomit:refresh-file-tree', () => {
      setTimeout(() => this._applyAll(), 0); // let the tree handler run first
    });
    this.dataModel.addEventListener('childrenLoaded', () => this._applyAll());
    this.dataModel.addEventListener('nodeAdded', () => this._applyAll());

    this.refresh();
  }

  async refresh() {
    // Coalesce: one request in flight; a change arriving meanwhile queues
    // exactly one follow-up so nothing is lost.
    if (this._inFlight) {
      this._dirty = true;
      return;
    }
    this._inFlight = true;
    try {
      const status = await window.vomit.gitStatus();
      this._cache = status && status.isRepo ? status : null;
    } catch (_) {
      this._cache = null;
    }
    this._inFlight = false;
    this._applyAll();
    if (this._dirty) {
      this._dirty = false;
      this.refresh();
    }
  }

  _applyAll() {
    // Remove stale badges first — a committed file must lose its dot.
    for (const path of this._badged) {
      const el = this.treeView.getElement(path);
      if (el) el.classList.remove(...GIT_BADGE_CLASSES);
    }
    this._badged.clear();
    if (!this._cache) return;

    for (const [path, status] of Object.entries(this._cache.files)) {
      const el = this.treeView.getElement(path);
      if (!el) continue;
      el.classList.add(`git-${status}`);
      this._badged.add(path);
    }
    for (const path of Object.keys(this._cache.folders)) {
      const el = this.treeView.getElement(path);
      if (!el) continue;
      el.classList.add('git-modified');
      this._badged.add(path);
    }
  }
}

window.GitBadgesManager = GitBadgesManager;

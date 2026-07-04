// GitGutterManager — git change indicators in the editor gutter.
//
// Diffs the live buffer against git HEAD (computed in the main process via
// the git-line-diff IPC) and marks added / modified / deleted lines in a
// dedicated 'git-gutter' CodeMirror gutter. The gutter column only exists
// when the open folder is inside a git repo, so non-repo use is unchanged.

class GitGutterManager {
  constructor({ host, state }) {
    this.host = host;
    this.state = state; // EditorState (currentFilePath, isRestoringTab, …)
    this._isRepo = false;
    this._seq = 0;
    this._debounceTimer = null;

    this._checkRepo();

    // HEAD/index changed (commit, branch switch, staging) or the workspace
    // changed — re-detect the repo and recompute markers.
    window.addEventListener('vomit:git-status-changed', () => {
      this._checkRepo();
    });
    window.addEventListener('vomit:open-folder', () => {
      this._checkRepo();
    });

    // Saves change the working-tree diff even though the buffer didn't move.
    window.addEventListener('vomit:file-saved', () => this.scheduleRefresh(0));
    window.addEventListener('vomit:file-saved-as', () => this.scheduleRefresh(0));

    // File/tab switch — recompute immediately for the new file.
    this.state.addEventListener('change:currentFilePath', () => this.scheduleRefresh(0));

    // Typing — debounced recompute.
    this.host.on('change', () => {
      if (this.state.isRestoringTab) return;
      this.scheduleRefresh(400);
    });
  }

  async _checkRepo() {
    try {
      const info = await window.vomit.gitRepoInfo();
      const isRepo = !!(info && info.isRepo);
      if (isRepo !== this._isRepo) {
        this._isRepo = isRepo;
        this.host.setGutters(isRepo ? ['git-gutter'] : []);
        if (!isRepo) this.host.clearGutter('git-gutter');
      }
      if (isRepo) this.scheduleRefresh(0);
    } catch (_) {
      // Main process not ready or git unavailable — stay disabled.
    }
  }

  scheduleRefresh(delay) {
    if (!this._isRepo) return;
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._refresh(), delay);
  }

  async _refresh() {
    if (!this._isRepo) return;
    const filePath = this.state.currentFilePath;
    if (!filePath) {
      this.host.clearGutter('git-gutter');
      return;
    }

    const seq = ++this._seq;
    let result;
    try {
      result = await window.vomit.gitLineDiff(filePath, this.host.getContent());
    } catch (_) {
      return;
    }
    // A newer request superseded this one, or the user switched files while
    // we were waiting — drop the stale response.
    if (seq !== this._seq || filePath !== this.state.currentFilePath) return;

    this.host.clearGutter('git-gutter');
    if (!result || !result.supported) return;

    const lineCount = this.host.lineCount();
    const apply = (lines, cls) => {
      for (const line of lines || []) {
        if (line < 0 || line >= lineCount) continue;
        this.host.setGutterMarker(line, 'git-gutter', this._marker(cls));
      }
    };
    // Deleted last: a triangle beats a bar when both land on one line.
    apply(result.added, 'git-added');
    apply(result.modified, 'git-modified');
    apply(result.deleted, 'git-deleted');
  }

  _marker(cls) {
    const el = document.createElement('div');
    el.className = `git-gutter-marker ${cls}`;
    return el;
  }
}

window.GitGutterManager = GitGutterManager;

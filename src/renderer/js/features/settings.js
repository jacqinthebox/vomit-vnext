// SettingsManager — Line numbers, shortcuts modal, documentation, keyboard nav, auto-save, sidebar resize.

class SettingsManager {
  constructor({ state, host, dom, getPreviewManager, getSearchManager, getTabManager }) {
    this.state = state;
    this.host = host;

    // DOM refs
    this.sidebarResize = dom.sidebarResize;
    this.sidebarFiles = dom.sidebarFiles;
    this.sidebarOutline = dom.sidebarOutline;
    this.sidebarSearch = dom.sidebarSearch;

    // Lazy getters for cross-module deps
    this._getPreviewManager = getPreviewManager;
    this._getSearchManager = getSearchManager;
    this._getTabManager = getTabManager;
  }

  get previewManager() { return this._getPreviewManager(); }
  get searchManager() { return this._getSearchManager(); }
  get tabManager() { return this._getTabManager(); }

  toggleLineNumbers() {
    const current = this.host.cm.getOption('lineNumbers');
    const newValue = !current;
    this.host.cm.setOption('lineNumbers', newValue);
    document.getElementById('editor').classList.toggle('has-line-numbers', newValue);
  }

  showShortcutsModal() {
    // Remove existing modal if any
    const existing = document.querySelector('.shortcuts-modal');
    if (existing) {
      existing.remove();
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'shortcuts-modal';
    modal.innerHTML = `
      <div class="shortcuts-content">
        <div class="shortcuts-header">
          <h2>Keyboard Shortcuts</h2>
          <button class="shortcuts-close">&times;</button>
        </div>
        <div class="shortcuts-body">
          <div class="shortcuts-section">
            <h3>Tabs</h3>
            <div class="shortcut-row"><kbd>Cmd+T</kbd> New tab</div>
            <div class="shortcut-row"><kbd>Cmd+W</kbd> Close tab</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+]</kbd> Next tab</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+[</kbd> Previous tab</div>
            <div class="shortcut-row"><kbd>Cmd+1-9</kbd> Go to tab</div>
          </div>
          <div class="shortcuts-section">
            <h3>File</h3>
            <div class="shortcut-row"><kbd>Cmd+N</kbd> New file</div>
            <div class="shortcut-row"><kbd>Cmd+O</kbd> Open file</div>
            <div class="shortcut-row"><kbd>Cmd+S</kbd> Save</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+S</kbd> Save as</div>
          </div>
          <div class="shortcuts-section">
            <h3>View</h3>
            <div class="shortcut-row"><kbd>Cmd+.</kbd> Command palette</div>
            <div class="shortcut-row"><kbd>Cmd+P</kbd> Toggle preview</div>
            <div class="shortcut-row"><kbd>Cmd+E</kbd> Toggle explorer</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+O</kbd> Toggle outline</div>
            <div class="shortcut-row"><kbd>Cmd+L</kbd> Toggle line numbers</div>
            <div class="shortcut-row"><kbd>Cmd+F</kbd> Find in file</div>
            <div class="shortcut-row"><kbd>Cmd+Option+F</kbd> Find and replace</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+F</kbd> Search in files</div>
            <div class="shortcut-row"><kbd>Cmd+/</kbd> Show shortcuts</div>
          </div>
          <div class="shortcuts-section">
            <h3>Format</h3>
            <div class="shortcut-row"><kbd>Cmd+B</kbd> Bold</div>
            <div class="shortcut-row"><kbd>Cmd+I</kbd> Italic</div>
            <div class="shortcut-row"><kbd>Cmd+\`</kbd> Code</div>
            <div class="shortcut-row"><kbd>Cmd+K</kbd> Insert link</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+T</kbd> Insert table</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+1/2/3</kbd> Headings</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+8</kbd> Bullet list</div>
            <div class="shortcut-row"><kbd>Cmd+Shift+9</kbd> Numbered list</div>
            <div class="shortcut-row"><kbd>Cmd+'</kbd> Quote</div>
            <div class="shortcut-row"><kbd>Cmd+-</kbd> Horizontal rule</div>
            <div class="shortcut-row"><kbd>Cmd+Enter</kbd> New slide</div>
          </div>
          <div class="shortcuts-section">
            <h3>Code</h3>
            <div class="shortcut-row"><kbd>Ctrl+J</kbd> Autocomplete</div>
            <div class="shortcut-row"><kbd>Ctrl+Space</kbd> Autocomplete</div>
          </div>
          <div class="shortcuts-section">
            <h3>Explorer</h3>
            <div class="shortcut-row"><kbd>↑↓</kbd> Navigate files</div>
            <div class="shortcut-row"><kbd>←→</kbd> Navigate folders</div>
            <div class="shortcut-row"><kbd>Enter</kbd> Open file/folder</div>
            <div class="shortcut-row"><kbd>Cmd+1</kbd> / <kbd>Ctrl+Tab</kbd> Toggle sidebar focus</div>
            <div class="shortcut-row"><kbd>Escape</kbd> Return to editor</div>
          </div>
          <div class="shortcuts-section">
            <h3>Presentation</h3>
            <div class="shortcut-row"><kbd>Cmd+Shift+P</kbd> Start presentation</div>
            <div class="shortcut-row"><kbd>Cmd+Alt+P</kbd> With presenter view</div>
            <div class="shortcut-row"><kbd>→/Space/N</kbd> Next slide</div>
            <div class="shortcut-row"><kbd>←/P</kbd> Previous slide</div>
            <div class="shortcut-row"><kbd>L</kbd> Laser pointer</div>
            <div class="shortcut-row"><kbd>Escape</kbd> End presentation</div>
          </div>
          <div class="shortcuts-section">
            <h3>AI Terminal</h3>
            <div class="shortcut-row"><kbd>Ctrl+\`</kbd> Toggle AI terminal</div>
            <div class="shortcut-row"><kbd>Ctrl+C</kbd> Stop AI response</div>
            <div class="shortcut-row"><kbd>Cmd+K</kbd> Clear terminal</div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    const close = () => modal.remove();
    modal.querySelector('.shortcuts-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', handler);
      }
    });
  }

  showDocumentation(content, filePath) {
    // Open documentation in a new tab with preview enabled
    this.tabManager.createTab(filePath || 'Documentation', content);

    // Enable preview mode for documentation
    if (!this.state.isPreviewVisible) {
      this.previewManager.togglePreview();
    }
  }

  setupKeyboardNavigation() {
    // Ctrl+W, Ctrl+Tab, or Ctrl+Esc to toggle focus between editor and sidebar
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && (e.key === 'w' || e.key === 'Tab' || e.key === 'Escape')) {
        e.preventDefault();
        e.stopPropagation();
        this.searchManager.togglePaneFocus();
      }
    }, true);  // capture phase

    // Cmd+1 from menu
    window.addEventListener('vomit:toggle-pane-focus', () => {
      this.searchManager.togglePaneFocus();
    });
  }

  async setupAutoSave() {
    // Load initial auto-save state from main process
    if (window.vomit && window.vomit.getAutoSaveEnabled) {
      this.state.autoSaveEnabled = await window.vomit.getAutoSaveEnabled();
    }

    // Listen for auto-save toggle changes
    window.addEventListener('vomit:auto-save-changed', (e) => {
      this.state.autoSaveEnabled = e.detail;
    });

    // Save when window loses focus
    window.addEventListener('blur', () => {
      if (this.state.autoSaveEnabled && this.state.isDirty && this.state.currentFilePath) {
        this.autoSave();
      }
    });

    // Save before closing/navigating away
    window.addEventListener('beforeunload', (e) => {
      if (this.state.autoSaveEnabled && this.state.isDirty && this.state.currentFilePath) {
        this.autoSave();
      }
    });
  }

  scheduleAutoSave() {
    // Only auto-save if enabled and file has been saved before (has a path)
    if (!this.state.autoSaveEnabled || !this.state.currentFilePath) return;

    // Clear existing timeout
    clearTimeout(this.state.autoSaveTimeout);

    // Schedule save for 2 seconds after last change
    this.state.autoSaveTimeout = setTimeout(() => {
      if (this.state.isDirty && this.state.autoSaveEnabled) {
        this.autoSave();
      }
    }, 2000);
  }

  autoSave() {
    if (!this.state.autoSaveEnabled || !this.state.isDirty || !this.state.currentFilePath) return;

    window.vomit.saveContent(this.host.cm.getValue());
    this.state.isDirty = false;
    this.previewManager.updateStatus();
  }

  setupSidebarResize() {
    let isResizing = false;
    let currentSidebar = null;

    this.sidebarResize.addEventListener('mousedown', (e) => {
      isResizing = true;
      this.sidebarResize.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      // Find which sidebar is visible
      if (this.state.isFileTreeVisible) currentSidebar = this.sidebarFiles;
      else if (this.state.isOutlineVisible) currentSidebar = this.sidebarOutline;
      else if (this.state.isSearchVisible) currentSidebar = this.sidebarSearch;
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing || !currentSidebar) return;

      const newWidth = Math.max(150, Math.min(500, e.clientX));
      currentSidebar.style.width = `${newWidth}px`;
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        currentSidebar = null;
        this.sidebarResize.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }
}

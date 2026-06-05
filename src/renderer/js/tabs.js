// TabManager - Handles multi-tab functionality for Vomit editor

class TabManager {
  constructor(editor) {
    this.editor = editor;
    this.tabs = new Map();
    this.activeTabId = null;
    this.tabOrder = [];
    this.closedTabs = [];
    this.maxClosedTabs = 10;
    this.tabCounter = 0;

    this.tabBar = document.getElementById('tab-bar');
    this.setupTabBarEvents();
  }

  generateTabId() {
    return `tab-${++this.tabCounter}-${Date.now()}`;
  }

  createTab(filePath = null, content = '') {
    const id = this.generateTabId();

    const tab = {
      id,
      filePath,
      content,
      isDirty: false,
      cursorPosition: { line: 0, ch: 0 },
      scrollInfo: { left: 0, top: 0 },
      history: null,
      lastAccessed: Date.now()
    };

    this.tabs.set(id, tab);
    this.tabOrder.push(id);

    // Switch to the new tab
    this.switchToTab(id);

    return tab;
  }

  saveCurrentTabState() {
    if (!this.activeTabId) return;

    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return;

    const cm = this.editor.cm;

    tab.content = cm.getValue();
    tab.cursorPosition = cm.getCursor();
    tab.scrollInfo = cm.getScrollInfo();
    tab.history = cm.getDoc().getHistory();
    tab.isDirty = this.editor.state.isDirty;
    tab.lastAccessed = Date.now();
  }

  restoreTabState(tab) {
    const cm = this.editor.cm;

    // Detect viewer files early (before cm.setValue triggers updatePreview)
    const ext = tab.filePath ? tab.filePath.split('.').pop().toLowerCase() : '';
    const isViewer = ['pdf', 'drawio'].includes(ext);
    const wasViewer = this.editor.state._isViewerMode;

    // Prevent change handler from marking tab dirty during restore
    this.editor.state.isRestoringTab = true;
    this.editor.state._isViewerMode = isViewer;

    // Set content (this clears history)
    cm.setValue(tab.content);

    // Restore history if available
    if (tab.history) {
      cm.getDoc().setHistory(tab.history);
    } else {
      cm.getDoc().clearHistory();
    }

    // Restore cursor
    if (tab.cursorPosition) {
      cm.setCursor(tab.cursorPosition);
    }

    // Restore scroll position after a brief delay to ensure content is rendered
    if (tab.scrollInfo) {
      setTimeout(() => {
        cm.scrollTo(tab.scrollInfo.left, tab.scrollInfo.top);
      }, 10);
    }

    // Update editor state
    this.editor.state.currentFilePath = tab.filePath;
    this.editor.state.basePath = tab.filePath ? window.PathUtils.dirname(tab.filePath) : null;
    this.editor.state.isDirty = tab.isDirty;

    // Re-enable change handler
    this.editor.state.isRestoringTab = false;

    // Handle viewer files (PDF, draw.io)
    if (isViewer) {
      this.editor.previewManager.showViewerFile(tab.filePath);
      this.editor.previewManager.updateStatus();
      return;
    }

    // Exit viewer mode if switching from a viewer tab to a normal tab
    if (wasViewer) {
      this.editor.previewManager.exitViewerMode();
    }

    // Update preview and status
    this.editor.previewManager.updatePreview();
    this.editor.previewManager.updateStatus();
    this.editor.previewManager.updateOutline();

    // Update inline images
    if (this.editor.inlineImages) {
      this.editor.inlineImages.clearAllWidgets();
      this.editor.inlineImages.updateAll();
    }
  }

  switchToTab(tabId) {
    if (tabId === this.activeTabId) return;

    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // Save current tab state before switching
    this.saveCurrentTabState();

    // Update active tab
    this.activeTabId = tabId;
    tab.lastAccessed = Date.now();

    // Restore the new tab's state
    this.restoreTabState(tab);

    // Update tab bar UI
    this.renderTabBar();

    // Update window title
    this.updateWindowTitle();

    // Notify main process of current file (for save dialog)
    if (window.vomit && window.vomit.setCurrentFile) {
      window.vomit.setCurrentFile(tab.filePath || null);
    }

    // Notify main process to watch this file
    if (tab.filePath && window.vomit && window.vomit.watchFile) {
      window.vomit.watchFile(tab.filePath);
    }
  }

  getTabByPath(filePath) {
    if (!filePath) return null;

    for (const [id, tab] of this.tabs) {
      if (tab.filePath === filePath) {
        return tab;
      }
    }
    return null;
  }

  async closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // Check for unsaved changes
    if (tab.isDirty) {
      const response = await window.vomit.showUnsavedChangesDialog(
        tab.filePath ? window.PathUtils.basename(tab.filePath) : 'Untitled'
      );

      if (response === 'save') {
        // Save the file first
        if (tabId === this.activeTabId) {
          await window.vomit.requestSave();
        }
        // Wait a moment for save to complete
        await new Promise(resolve => setTimeout(resolve, 100));
      } else if (response === 'cancel') {
        return; // Don't close
      }
      // 'discard' falls through to close
    }

    // Add to closed tabs stack for potential reopen
    this.closedTabs.push({ ...tab });
    if (this.closedTabs.length > this.maxClosedTabs) {
      this.closedTabs.shift();
    }

    // Get current index before removal
    const currentIndex = this.tabOrder.indexOf(tabId);

    // Remove tab
    this.tabs.delete(tabId);
    this.tabOrder = this.tabOrder.filter(id => id !== tabId);

    // If we closed the active tab, switch to another
    if (tabId === this.activeTabId) {
      if (this.tabOrder.length === 0) {
        // No tabs left, create a new untitled tab
        this.activeTabId = null;
        this.createTab();
      } else {
        // Switch to adjacent tab
        const newIndex = Math.min(currentIndex, this.tabOrder.length - 1);
        this.activeTabId = null; // Clear to force switch
        this.switchToTab(this.tabOrder[newIndex]);
      }
    } else {
      this.renderTabBar();
    }
  }

  closeCurrentTab() {
    if (this.activeTabId) {
      this.closeTab(this.activeTabId);
    }
  }

  closeAllTabs(force = false, createNew = true) {
    // Close all tabs without prompting (used when switching projects)
    if (force) {
      this.tabs.clear();
      this.tabOrder = [];
      this.activeTabId = null;
      this.renderTabBar();
      if (createNew) {
        this.createTab();
      }
      return;
    }

    // Otherwise close each tab normally (will prompt for unsaved)
    const tabIds = [...this.tabOrder];
    for (const tabId of tabIds) {
      this.closeTab(tabId);
    }
  }

  nextTab() {
    if (this.tabOrder.length <= 1) return;

    const currentIndex = this.tabOrder.indexOf(this.activeTabId);
    const nextIndex = (currentIndex + 1) % this.tabOrder.length;
    this.switchToTab(this.tabOrder[nextIndex]);
  }

  prevTab() {
    if (this.tabOrder.length <= 1) return;

    const currentIndex = this.tabOrder.indexOf(this.activeTabId);
    const prevIndex = (currentIndex - 1 + this.tabOrder.length) % this.tabOrder.length;
    this.switchToTab(this.tabOrder[prevIndex]);
  }

  goToTab(n) {
    // n is 1-indexed for user convenience
    if (n === 9) {
      // Cmd+9 goes to last tab
      if (this.tabOrder.length > 0) {
        this.switchToTab(this.tabOrder[this.tabOrder.length - 1]);
      }
    } else if (n >= 1 && n <= this.tabOrder.length) {
      this.switchToTab(this.tabOrder[n - 1]);
    }
  }

  reopenLastClosedTab() {
    if (this.closedTabs.length === 0) return;

    const tab = this.closedTabs.pop();

    // Check if file is already open
    if (tab.filePath) {
      const existingTab = this.getTabByPath(tab.filePath);
      if (existingTab) {
        this.switchToTab(existingTab.id);
        return;
      }
    }

    // Recreate the tab
    const newId = this.generateTabId();
    const newTab = {
      ...tab,
      id: newId,
      lastAccessed: Date.now()
    };

    this.tabs.set(newId, newTab);
    this.tabOrder.push(newId);
    this.switchToTab(newId);
  }

  updateWindowTitle() {
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return;

    const filename = tab.filePath
      ? window.PathUtils.basename(tab.filePath)
      : 'Untitled';
    const dirtyIndicator = tab.isDirty ? ' *' : '';

    document.title = `${filename}${dirtyIndicator} - Vomit`;
  }

  markCurrentTabDirty() {
    if (!this.activeTabId) return;

    const tab = this.tabs.get(this.activeTabId);
    if (tab && !tab.isDirty) {
      tab.isDirty = true;
      this.renderTabBar();
      this.updateWindowTitle();
    }
  }

  markCurrentTabClean() {
    if (!this.activeTabId) return;

    const tab = this.tabs.get(this.activeTabId);
    if (tab && tab.isDirty) {
      tab.isDirty = false;
      this.renderTabBar();
      this.updateWindowTitle();
    }
  }

  updateCurrentTabPath(filePath) {
    if (!this.activeTabId) return;

    const tab = this.tabs.get(this.activeTabId);
    if (tab) {
      tab.filePath = filePath;
      this.editor.state.currentFilePath = filePath;
      this.editor.state.basePath = filePath ? window.PathUtils.dirname(filePath) : null;
      this.renderTabBar();
      this.updateWindowTitle();
    }
  }

  setupTabBarEvents() {
    if (!this.tabBar) return;

    // Event delegation for tab clicks
    this.tabBar.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;

      const tabId = tab.dataset.tabId;

      if (e.target.classList.contains('tab-close')) {
        e.stopPropagation();
        this.closeTab(tabId);
      } else {
        this.switchToTab(tabId);
      }
    });

    // Middle-click to close tab
    this.tabBar.addEventListener('auxclick', (e) => {
      if (e.button === 1) { // Middle click
        const tab = e.target.closest('.tab');
        if (tab) {
          e.preventDefault();
          this.closeTab(tab.dataset.tabId);
        }
      }
    });

    // Keyboard navigation in tab bar
    this.tabBar.addEventListener('keydown', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.switchToTab(tab.dataset.tabId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.closeTab(tab.dataset.tabId);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const next = tab.nextElementSibling;
        if (next) next.focus();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = tab.previousElementSibling;
        if (prev) prev.focus();
      }
    });
  }

  renderTabBar() {
    if (!this.tabBar) return;

    this.tabBar.innerHTML = this.tabOrder.map((tabId, index) => {
      const tab = this.tabs.get(tabId);
      if (!tab) return '';

      const isActive = tabId === this.activeTabId;
      const displayName = tab.filePath
        ? window.PathUtils.basename(tab.filePath)
        : 'Untitled';
      const number = index < 9 ? index + 1 : '';
      const title = tab.filePath || 'Untitled';

      return `
        <div class="tab ${isActive ? 'active' : ''}"
             data-tab-id="${tabId}"
             tabindex="0"
             title="${title}">
          ${number ? `<span class="tab-number">${number}</span>` : ''}
          ${tab.isDirty ? '<span class="tab-dirty">*</span>' : ''}
          <span class="tab-title">${displayName}</span>
          <button class="tab-close" aria-label="Close tab">&times;</button>
        </div>
      `;
    }).join('');
  }

  // Persistence methods
  serializeState() {
    return {
      tabs: Array.from(this.tabs.values()).map(tab => ({
        filePath: tab.filePath,
        content: tab.content,
        isDirty: tab.isDirty,
        cursorPosition: tab.cursorPosition,
        scrollInfo: tab.scrollInfo
        // Note: history is not persisted (too large)
      })),
      activeTabIndex: this.tabOrder.indexOf(this.activeTabId),
      tabOrder: this.tabOrder.map(id => {
        const tab = this.tabs.get(id);
        return tab ? tab.filePath : null;
      })
    };
  }

  restoreState(data) {
    if (!data || !data.tabs || data.tabs.length === 0) {
      // No saved state, create default tab
      this.createTab();
      return;
    }

    // Restore each tab
    data.tabs.forEach(savedTab => {
      const id = this.generateTabId();
      const tab = {
        id,
        filePath: savedTab.filePath,
        content: savedTab.content,
        isDirty: savedTab.isDirty || false,
        cursorPosition: savedTab.cursorPosition || { line: 0, ch: 0 },
        scrollInfo: savedTab.scrollInfo || { left: 0, top: 0 },
        history: null,
        lastAccessed: Date.now()
      };

      this.tabs.set(id, tab);
      this.tabOrder.push(id);
    });

    // Switch to the previously active tab
    const activeIndex = data.activeTabIndex >= 0 && data.activeTabIndex < this.tabOrder.length
      ? data.activeTabIndex
      : 0;

    this.switchToTab(this.tabOrder[activeIndex]);
  }
}

// Export for use in editor.js
window.TabManager = TabManager;

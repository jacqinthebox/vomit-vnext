// FileTreeManager — File tree sidebar, folder navigation, context menus, and file operations.

class FileTreeManager {
  constructor({ state, host, dom, getTabManager, getPreviewManager }) {
    this.state = state;
    this.host = host;

    // DOM refs
    this.sidebarFiles = dom.sidebarFiles;
    this.sidebarOutline = dom.sidebarOutline;
    this.sidebarSearch = dom.sidebarSearch;
    this.fileTree = dom.fileTree;
    this.sidebarResize = dom.sidebarResize;

    // Lazy getters for cross-module deps
    this._getTabManager = getTabManager;
    this._getPreviewManager = getPreviewManager;
  }

  get tabManager() { return this._getTabManager(); }
  get previewManager() { return this._getPreviewManager(); }

  toggleFileTree() {
    this.state.isFileTreeVisible = !this.state.isFileTreeVisible;
    this.sidebarFiles.classList.toggle('hidden', !this.state.isFileTreeVisible);
    this.updateResizeHandle();
    if (this.state.isFileTreeVisible) {
      // Close other sidebars
      this.state.isOutlineVisible = false;
      this.state.isSearchVisible = false;
      this.sidebarOutline.classList.add('hidden');
      this.sidebarSearch.classList.add('hidden');
      this.state.focusedPane = 'sidebar';
      this.loadFileTree().then(() => {
        const firstItem = this.fileTree.querySelector('.file-item');
        if (firstItem) firstItem.focus();
      });
    } else {
      // Return focus to editor when hiding
      this.state.focusedPane = 'editor';
      this.host.focus();
    }
  }

  toggleOutline() {
    this.state.isOutlineVisible = !this.state.isOutlineVisible;
    this.sidebarOutline.classList.toggle('hidden', !this.state.isOutlineVisible);
    this.updateResizeHandle();
    if (this.state.isOutlineVisible) {
      // Close other sidebars
      this.state.isFileTreeVisible = false;
      this.state.isSearchVisible = false;
      this.sidebarFiles.classList.add('hidden');
      this.sidebarSearch.classList.add('hidden');
      this.previewManager.updateOutline();
    }
  }

  navigateToParent() {
    if (!this.state.currentDirectory) return;
    // Don't navigate above project root
    if (this.state.projectRoot && this.state.currentDirectory === this.state.projectRoot) return;

    const parts = this.state.currentDirectory.split('/');
    if (parts.length > 2) {
      const newDir = parts.slice(0, -1).join('/');
      // Extra check: don't go above project root
      if (this.state.projectRoot && !newDir.startsWith(this.state.projectRoot)) return;

      this.state.currentDirectory = newDir;
      this.loadFileTree().then(() => {
        // Focus first item after navigating up
        const firstItem = this.fileTree.querySelector('.file-item');
        if (firstItem) firstItem.focus();
      });
    }
  }

  openFolder(folderPath) {
    // Close all existing tabs when opening/switching projects (don't auto-create untitled)
    if (this.tabManager) {
      // If switching projects OR first time opening a folder with only an empty untitled tab
      const hasOnlyEmptyUntitled = this.tabManager.tabs.size === 1 &&
        !this.tabManager.tabs.values().next().value.filePath &&
        !this.tabManager.tabs.values().next().value.content.trim();

      if ((this.state.projectRoot && this.state.projectRoot !== folderPath) || hasOnlyEmptyUntitled) {
        this.tabManager.closeAllTabs(true, false);
      }
    }

    this.state.currentDirectory = folderPath;
    this.state.projectRoot = folderPath; // Set as project root - can't navigate above this

    // Update sidebar header with folder name
    const folderName = folderPath.split('/').pop().toUpperCase();
    const sidebarFolderName = document.getElementById('sidebar-folder-name');
    if (sidebarFolderName) {
      sidebarFolderName.textContent = folderName;
    }

    // Load file tree data (but don't show sidebar - user can toggle with Cmd+E)
    this.loadFileTree();
  }

  setupFileTreeContextMenu() {
    // Context menu for sidebar header (create folder at project root)
    const sidebarHeader = this.sidebarFiles.querySelector('.sidebar-header');
    if (sidebarHeader) {
      sidebarHeader.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.state.projectRoot) {
          this.showRootContextMenu(e.clientX, e.clientY);
        }
      });
    }

    // Context menu for file tree empty space (create folder at current directory)
    this.fileTree.addEventListener('contextmenu', (e) => {
      // Only trigger if clicking on the file tree itself, not on file items
      if (e.target === this.fileTree || e.target.classList.contains('empty-message')) {
        e.preventDefault();
        if (this.state.currentDirectory) {
          this.showRootContextMenu(e.clientX, e.clientY);
        }
      }
    });
  }

  showRootContextMenu(x, y) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.file-context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'file-context-menu';
    menu.innerHTML = `
      <div class="context-menu-item" data-action="new-file">New File</div>
      <div class="context-menu-item" data-action="new-folder">New Folder</div>
    `;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);

    // Handle menu item clicks
    menu.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'new-file') {
        this.createNewFile(this.state.currentDirectory);
      } else if (action === 'new-folder') {
        this.createNewFolder(this.state.currentDirectory);
      }
      menu.remove();
    });

    // Close menu on outside click
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  updateResizeHandle() {
    const anySidebarVisible = this.state.isFileTreeVisible || this.state.isOutlineVisible || this.state.isSearchVisible;
    this.sidebarResize.classList.toggle('hidden', !anySidebarVisible);
  }

  async loadFileTree() {
    if (!this.state.currentDirectory) {
      // Try to get current directory from main process
      this.state.currentDirectory = await window.vomit.getCurrentDirectory();
    }

    if (!this.state.currentDirectory) {
      this.fileTree.innerHTML = '<div class="file-item" style="color: var(--text-muted); padding: 16px;">Open a file to see its directory</div>';
      return;
    }

    const items = await window.vomit.getDirectoryContents(this.state.currentDirectory);
    this.renderFileTree(items);
  }

  renderFileTree(items) {
    if (!items || items.length === 0) {
      this.fileTree.innerHTML = '<div class="file-item empty-message" style="color: var(--text-muted);">Empty folder</div>';
      return;
    }

    // Cache items for the current directory
    this.state.treeCache.set(this.state.currentDirectory, items);

    // Render tree starting from root
    this.fileTree.innerHTML = '';

    // Add ".." parent item if not at project root
    const isAtProjectRoot = this.state.projectRoot && this.state.currentDirectory === this.state.projectRoot;
    if (!isAtProjectRoot && this.state.currentDirectory) {
      const parentItem = document.createElement('div');
      parentItem.className = 'file-item directory parent-dir';
      parentItem.dataset.path = this.state.currentDirectory.split('/').slice(0, -1).join('/');
      parentItem.dataset.isDir = 'true';
      parentItem.dataset.depth = '0';
      parentItem.tabIndex = 0;
      parentItem.style.paddingLeft = '8px';
      parentItem.innerHTML = `
        <span class="chevron"></span>
        <span class="icon"></span>
        <span class="name">..</span>
      `;
      parentItem.addEventListener('click', () => this.navigateToParent());
      parentItem.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.navigateToParent();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.focusNextTreeItem(parentItem);
        }
      });
      this.fileTree.appendChild(parentItem);
    }

    this.renderTreeItems(items, this.fileTree, 0);
    this.attachTreeHandlers();
  }

  renderTreeItems(items, container, depth) {
    const chevronSvg = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4"/></svg>`;

    items.forEach(item => {
      const isActive = item.path === this.state.currentFilePath;
      const isExpanded = this.state.expandedFolders.has(item.path);
      const typeClass = item.isDirectory ? 'directory' : (item.isMarkdown ? 'markdown' : 'file');
      const activeClass = isActive ? 'active' : '';
      const expandedClass = isExpanded ? 'expanded' : '';
      const indent = depth * 16;

      const itemEl = document.createElement('div');
      itemEl.className = `file-item ${typeClass} ${activeClass} ${expandedClass}`.trim();
      itemEl.dataset.path = item.path;
      itemEl.dataset.isDir = item.isDirectory;
      itemEl.dataset.depth = depth;
      itemEl.tabIndex = 0;
      itemEl.style.paddingLeft = `${8 + indent}px`;
      itemEl.innerHTML = `
        <span class="chevron">${chevronSvg}</span>
        <span class="icon"></span>
        <span class="name">${item.name}</span>
      `;
      container.appendChild(itemEl);

      // If directory is expanded and we have cached children, render them
      if (item.isDirectory && isExpanded) {
        const childContainer = document.createElement('div');
        childContainer.className = 'tree-children expanded';
        childContainer.dataset.parentPath = item.path;
        container.appendChild(childContainer);

        const cachedChildren = this.state.treeCache.get(item.path);
        if (cachedChildren) {
          this.renderTreeItems(cachedChildren, childContainer, depth + 1);
        }
      }
    });
  }

  attachTreeHandlers() {
    this.fileTree.querySelectorAll('.file-item').forEach(el => {
      const handleToggle = async () => {
        const filePath = el.dataset.path;
        const isDir = el.dataset.isDir === 'true';

        if (isDir) {
          await this.toggleFolder(el, filePath);
        } else {
          // Update active state
          this.fileTree.querySelectorAll('.file-item.active').forEach(item => item.classList.remove('active'));
          el.classList.add('active');
          this.state.focusedPane = 'sidebar';
          window.vomit.openFile(filePath);
        }
      };

      el.addEventListener('click', handleToggle);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleToggle();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.focusNextTreeItem(el);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.focusPrevTreeItem(el);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          const isDir = el.dataset.isDir === 'true';
          const isExpanded = el.classList.contains('expanded');
          if (isDir && !isExpanded) {
            handleToggle();
          } else if (isDir && isExpanded) {
            this.focusNextTreeItem(el);
          }
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const isDir = el.dataset.isDir === 'true';
          const isExpanded = el.classList.contains('expanded');
          if (isDir && isExpanded) {
            handleToggle();
          } else {
            this.focusParentFolder(el);
          }
        } else if (e.key === 'Escape') {
          this.host.focus();
          this.state.focusedPane = 'editor';
        }
      });

      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showFileContextMenu(el, e.clientX, e.clientY);
      });
    });
  }

  async toggleFolder(el, folderPath) {
    const isExpanded = el.classList.contains('expanded');

    if (isExpanded) {
      // Collapse: remove expanded class and children container
      el.classList.remove('expanded');
      this.state.expandedFolders.delete(folderPath);
      const childContainer = el.nextElementSibling;
      if (childContainer && childContainer.classList.contains('tree-children')) {
        childContainer.remove();
      }
    } else {
      // Expand: add expanded class and load children
      el.classList.add('expanded');
      this.state.expandedFolders.add(folderPath);

      // Check cache first
      let children = this.state.treeCache.get(folderPath);
      if (!children) {
        children = await window.vomit.getDirectoryContents(folderPath);
        this.state.treeCache.set(folderPath, children);
      }

      if (children && children.length > 0) {
        const childContainer = document.createElement('div');
        childContainer.className = 'tree-children expanded';
        childContainer.dataset.parentPath = folderPath;
        el.after(childContainer);

        const depth = parseInt(el.dataset.depth) + 1;
        this.renderTreeItems(children, childContainer, depth);
        this.attachTreeHandlers();
      }
    }
  }

  focusNextTreeItem(el) {
    // Get all visible file items
    const allItems = Array.from(this.fileTree.querySelectorAll('.file-item'));
    const currentIndex = allItems.indexOf(el);
    if (currentIndex < allItems.length - 1) {
      allItems[currentIndex + 1].focus();
    }
  }

  focusPrevTreeItem(el) {
    const allItems = Array.from(this.fileTree.querySelectorAll('.file-item'));
    const currentIndex = allItems.indexOf(el);
    if (currentIndex > 0) {
      allItems[currentIndex - 1].focus();
    }
  }

  focusParentFolder(el) {
    // Find the parent folder by looking at depth
    const depth = parseInt(el.dataset.depth);
    if (depth === 0) return;

    const allItems = Array.from(this.fileTree.querySelectorAll('.file-item'));
    const currentIndex = allItems.indexOf(el);

    // Search backwards for an item with lower depth
    for (let i = currentIndex - 1; i >= 0; i--) {
      const itemDepth = parseInt(allItems[i].dataset.depth);
      if (itemDepth < depth) {
        allItems[i].focus();
        return;
      }
    }
  }

  showFileContextMenu(el, x, y) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.file-context-menu');
    if (existingMenu) existingMenu.remove();

    const filePath = el.dataset.path;
    const isParentDir = el.classList.contains('parent-dir');

    // Don't show menu for parent directory (..)
    if (isParentDir) return;

    const isDir = el.dataset.isDir === 'true';
    const menu = document.createElement('div');
    menu.className = 'file-context-menu';
    menu.innerHTML = `
      <div class="context-menu-item" data-action="new-file">New File</div>
      <div class="context-menu-item" data-action="new-folder">New Folder</div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="rename">Rename</div>
      <div class="context-menu-item" data-action="delete">Delete</div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="finder">Show in Finder</div>
    `;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);

    // Handle menu item clicks
    menu.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'new-file') {
        const targetDir = isDir ? filePath : this.state.currentDirectory;
        this.createNewFile(targetDir);
      } else if (action === 'new-folder') {
        const targetDir = isDir ? filePath : this.state.currentDirectory;
        this.createNewFolder(targetDir);
      } else if (action === 'rename') {
        this.startRename(el);
      } else if (action === 'delete') {
        this.deleteItem(filePath);
      } else if (action === 'finder') {
        window.vomit.showInFinder(filePath);
      }
      menu.remove();
    });

    // Close menu on outside click
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  startRename(el) {
    const filePath = el.dataset.path;
    const nameSpan = el.querySelector('.name');
    const currentName = nameSpan.textContent;

    // Create inline input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = currentName;

    // Replace name span with input
    nameSpan.style.display = 'none';
    el.appendChild(input);
    input.focus();
    input.select();

    const finishRename = async (save) => {
      if (save) {
        const newName = input.value.trim();
        if (newName && newName !== currentName) {
          const result = await window.vomit.renameItem(filePath, newName);
          if (!result.success) {
            alert(result.error || 'Failed to rename');
          }
        }
      }
      input.remove();
      nameSpan.style.display = '';
      this.loadFileTree();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finishRename(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finishRename(false);
      }
    });

    input.addEventListener('blur', () => {
      finishRename(true);
    });
  }

  async deleteItem(itemPath) {
    const result = await window.vomit.deleteItem(itemPath);
    if (result.success) {
      // Close tab if the deleted file was open
      if (this.tabManager) {
        const tab = this.tabManager.getTabByPath(itemPath);
        if (tab) {
          // Force close without prompting for save (file is already deleted)
          this.tabManager.tabs.delete(tab.id);
          this.tabManager.tabOrder = this.tabManager.tabOrder.filter(id => id !== tab.id);

          // If it was the active tab, switch to another
          if (tab.id === this.tabManager.activeTabId) {
            if (this.tabManager.tabOrder.length === 0) {
              this.tabManager.activeTabId = null;
              this.tabManager.createTab();
            } else {
              this.tabManager.activeTabId = null;
              this.tabManager.switchToTab(this.tabManager.tabOrder[0]);
            }
          } else {
            this.tabManager.renderTabBar();
          }
        }
      }
      // Clear tree cache for parent directory to force refresh
      const parentDir = itemPath.substring(0, itemPath.lastIndexOf('/'));
      this.state.treeCache.delete(parentDir);
      // Also remove from expanded folders if it was a folder
      this.state.expandedFolders.delete(itemPath);
      this.loadFileTree();
    } else if (result.error) {
      alert(result.error);
    }
  }

  async createNewFolder(parentDir) {
    // Use current directory if no parent specified
    const targetDir = parentDir || this.state.currentDirectory;
    if (!targetDir) {
      alert('No folder open. Open a folder first.');
      return;
    }

    // Create inline input in the file tree
    const inputContainer = document.createElement('div');
    inputContainer.className = 'file-item new-folder-input';
    inputContainer.innerHTML = `
      <span class="icon">📁</span>
      <input type="text" class="rename-input" placeholder="folder name" value="New Folder">
    `;

    // Find where to insert the input
    // If the parent folder is expanded, insert at the start of its children
    const parentEl = this.fileTree.querySelector(`.file-item[data-path="${CSS.escape(targetDir)}"]`);
    let insertTarget = this.fileTree;

    if (parentEl && parentEl.dataset.isDir === 'true') {
      const childContainer = parentEl.nextElementSibling;
      if (childContainer && childContainer.classList.contains('tree-children')) {
        insertTarget = childContainer;
      } else {
        // Expand folder first if not expanded
        if (!parentEl.classList.contains('expanded')) {
          await this.toggleFolder(parentEl, targetDir);
        }
        const newChildContainer = parentEl.nextElementSibling;
        if (newChildContainer && newChildContainer.classList.contains('tree-children')) {
          insertTarget = newChildContainer;
        }
      }
    }

    // Insert at the beginning of the target container
    insertTarget.insertBefore(inputContainer, insertTarget.firstChild);

    const input = inputContainer.querySelector('input');
    input.focus();
    input.select();

    const finishCreate = async (save) => {
      if (save) {
        const folderName = input.value.trim();
        if (folderName) {
          const newFolderPath = `${targetDir}/${folderName}`;
          try {
            await window.vomit.createDirectory(newFolderPath);
            // Clear tree cache for parent to force refresh
            this.state.treeCache.delete(targetDir);
          } catch (err) {
            alert(`Failed to create folder: ${err.message}`);
          }
        }
      }
      inputContainer.remove();
      this.loadFileTree();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finishCreate(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finishCreate(false);
      }
    });

    input.addEventListener('blur', () => {
      finishCreate(true);
    });
  }

  async createNewFile(parentDir) {
    // Use current directory if no parent specified
    const targetDir = parentDir || this.state.currentDirectory;
    if (!targetDir) {
      alert('No folder open. Open a folder first.');
      return;
    }

    // Create inline input in the file tree
    const inputContainer = document.createElement('div');
    inputContainer.className = 'file-item new-file-input';
    inputContainer.innerHTML = `
      <span class="icon">📄</span>
      <input type="text" class="rename-input" placeholder="filename.md" value="untitled.md">
    `;

    // Find where to insert the input
    const parentEl = this.fileTree.querySelector(`.file-item[data-path="${CSS.escape(targetDir)}"]`);
    let insertTarget = this.fileTree;

    if (parentEl && parentEl.dataset.isDir === 'true') {
      const childContainer = parentEl.nextElementSibling;
      if (childContainer && childContainer.classList.contains('tree-children')) {
        insertTarget = childContainer;
      } else {
        // Expand folder first if not expanded
        if (!parentEl.classList.contains('expanded')) {
          await this.toggleFolder(parentEl, targetDir);
        }
        const newChildContainer = parentEl.nextElementSibling;
        if (newChildContainer && newChildContainer.classList.contains('tree-children')) {
          insertTarget = newChildContainer;
        }
      }
    }

    // Insert at the beginning of the target container
    insertTarget.insertBefore(inputContainer, insertTarget.firstChild);

    const input = inputContainer.querySelector('input');
    input.focus();
    // Select just the filename part, not the extension
    const dotIndex = input.value.lastIndexOf('.');
    if (dotIndex > 0) {
      input.setSelectionRange(0, dotIndex);
    } else {
      input.select();
    }

    const finishCreate = async (save) => {
      if (save) {
        const fileName = input.value.trim();
        if (fileName) {
          const newFilePath = `${targetDir}/${fileName}`;
          try {
            // Create empty file
            await window.vomit.writeFile(newFilePath, '');
            // Clear tree cache for parent to force refresh
            this.state.treeCache.delete(targetDir);
            // Open the new file
            window.vomit.openFile(newFilePath);
          } catch (err) {
            alert(`Failed to create file: ${err.message}`);
          }
        }
      }
      inputContainer.remove();
      this.loadFileTree();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finishCreate(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finishCreate(false);
      }
    });

    input.addEventListener('blur', () => {
      finishCreate(true);
    });
  }
}

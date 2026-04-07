// FileTreeManager - Orchestrator for file tree
// Coordinates TreeState, TreeDataModel, and TreeView
// Handles user interactions, IPC, and sidebar visibility

class FileTreeManager {
  constructor({ state, host, dom, getTabManager, getPreviewManager }) {
    this.editorState = state;
    this.host = host;

    // DOM refs
    this.sidebarFiles = dom.sidebarFiles;
    this.sidebarOutline = dom.sidebarOutline;
    this.sidebarSearch = dom.sidebarSearch;
    this.fileTreeContainer = dom.fileTree;
    this.sidebarResize = dom.sidebarResize;

    // Lazy getters
    this._getTabManager = getTabManager;
    this._getPreviewManager = getPreviewManager;

    // Create the three core components
    this.treeState = new TreeState();
    this.dataModel = new TreeDataModel();
    this.treeView = new TreeView(this.fileTreeContainer, this.dataModel, this.treeState);

    // Set up event handling
    this._setupEventDelegation();
    this._setupKeyboardNavigation();
    this._setupDragAndDrop();
  }

  get tabManager() { return this._getTabManager(); }
  get previewManager() { return this._getPreviewManager(); }

  // ─────────────────────────────────────────────────────────────
  // Sidebar visibility (independent of file operations)
  // ─────────────────────────────────────────────────────────────

  toggleFileTree() {
    this.editorState.isFileTreeVisible = !this.editorState.isFileTreeVisible;
    this.sidebarFiles.classList.toggle('hidden', !this.editorState.isFileTreeVisible);
    this.updateResizeHandle();

    if (this.editorState.isFileTreeVisible) {
      // Hide other sidebars
      this.editorState.isOutlineVisible = false;
      this.editorState.isSearchVisible = false;
      this.sidebarOutline.classList.add('hidden');
      this.sidebarSearch.classList.add('hidden');
      this.editorState.focusedPane = 'sidebar';

      // Load tree if needed
      this._ensureTreeLoaded().then(() => {
        this._focusFirstOrSelected();
      });
    } else {
      this.editorState.focusedPane = 'editor';
      this.host.focus();
    }
  }

  toggleOutline() {
    this.editorState.isOutlineVisible = !this.editorState.isOutlineVisible;
    this.sidebarOutline.classList.toggle('hidden', !this.editorState.isOutlineVisible);
    this.updateResizeHandle();

    if (this.editorState.isOutlineVisible) {
      this.editorState.isFileTreeVisible = false;
      this.editorState.isSearchVisible = false;
      this.sidebarFiles.classList.add('hidden');
      this.sidebarSearch.classList.add('hidden');
      this.previewManager.updateOutline();
    }
  }

  updateResizeHandle() {
    const anySidebarVisible = this.editorState.isFileTreeVisible ||
                               this.editorState.isOutlineVisible ||
                               this.editorState.isSearchVisible;
    this.sidebarResize.classList.toggle('hidden', !anySidebarVisible);
  }

  // ─────────────────────────────────────────────────────────────
  // Tree loading
  // ─────────────────────────────────────────────────────────────

  async openFolder(folderPath) {
    // Close tabs when switching projects
    if (this.tabManager) {
      const hasOnlyEmptyUntitled = this.tabManager.tabs.size === 1 &&
        !this.tabManager.tabs.values().next().value.filePath &&
        !this.tabManager.tabs.values().next().value.content.trim();
      const isSwitchingProjects = this.treeState.rootPath && this.treeState.rootPath !== folderPath;

      if (isSwitchingProjects || hasOnlyEmptyUntitled) {
        this.tabManager.closeAllTabs(true, false);
        if (isSwitchingProjects) {
          this.tabManager.createTab(null, '');
        }
      }
    }

    // Update editor state
    this.editorState.currentDirectory = folderPath;
    this.editorState.projectRoot = folderPath;

    // Update tree state and data model
    this.treeState.setRoot(folderPath);
    this.dataModel.setRoot(folderPath);

    // Update sidebar header
    const folderName = folderPath.split('/').pop().toUpperCase();
    const sidebarFolderName = document.getElementById('sidebar-folder-name');
    if (sidebarFolderName) {
      sidebarFolderName.textContent = folderName;
    }

    // Load root children
    await this.dataModel.loadChildren(folderPath);
  }

  async refresh() {
    await this._ensureTreeLoaded();
  }

  async loadFileTree() {
    await this._ensureTreeLoaded();
  }

  async _ensureTreeLoaded() {
    // Use projectRoot as the stable tree root (not currentDirectory which follows open file)
    const rootDir = this.editorState.projectRoot || this.editorState.currentDirectory;

    if (!rootDir) {
      const dir = await window.vomit.getCurrentDirectory();
      if (dir) {
        this.editorState.currentDirectory = dir;
        this.editorState.projectRoot = dir;
      }
    }

    const effectiveRoot = this.editorState.projectRoot || this.editorState.currentDirectory;

    if (!effectiveRoot) {
      this.fileTreeContainer.innerHTML = '<div class="file-item empty-message" style="color: var(--text-muted); padding: 16px;">Open a file to see its directory</div>';
      return;
    }

    // Only set root if not already set OR if projectRoot changed
    if (!this.treeState.rootPath || this.treeState.rootPath !== effectiveRoot) {
      this.treeState.setRoot(effectiveRoot);
      this.dataModel.setRoot(effectiveRoot);
    }

    // Load root children if not loaded
    if (!this.dataModel.hasChildren(this.treeState.rootPath)) {
      await this.dataModel.loadChildren(this.treeState.rootPath);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Event delegation
  // ─────────────────────────────────────────────────────────────

  _setupEventDelegation() {
    // Click handler
    this.fileTreeContainer.addEventListener('click', async (e) => {
      const el = e.target.closest('.file-item');
      if (!el || !el.dataset.path) return;

      const path = el.dataset.path;
      const isDir = el.dataset.isDir === 'true';

      if (isDir) {
        await this._toggleFolder(path);
      } else {
        this._selectAndOpenFile(path);
      }
    });

    // Context menu
    this.fileTreeContainer.addEventListener('contextmenu', (e) => {
      const el = e.target.closest('.file-item');
      if (el && el.dataset.path) {
        e.preventDefault();
        this._showContextMenu(el, e.clientX, e.clientY);
      } else if (e.target === this.fileTreeContainer || e.target.classList.contains('empty-message')) {
        e.preventDefault();
        if (this.editorState.currentDirectory) {
          this._showRootContextMenu(e.clientX, e.clientY);
        }
      }
    });
  }

  _setupKeyboardNavigation() {
    this.fileTreeContainer.addEventListener('keydown', async (e) => {
      const el = e.target.closest('.file-item');
      if (!el || !el.dataset.path) return;

      const path = el.dataset.path;
      const isDir = el.dataset.isDir === 'true';

      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          if (isDir) {
            await this._toggleFolder(path);
          } else {
            this._selectAndOpenFile(path);
          }
          break;

        case 'ArrowDown':
          e.preventDefault();
          this._focusNext(path);
          break;

        case 'ArrowUp':
          e.preventDefault();
          this._focusPrev(path);
          break;

        case 'ArrowRight':
          e.preventDefault();
          if (isDir) {
            if (!this.treeState.isExpanded(path)) {
              await this._expandFolder(path);
            } else {
              this._focusNext(path);
            }
          }
          break;

        case 'ArrowLeft':
          e.preventDefault();
          if (isDir && this.treeState.isExpanded(path)) {
            this.treeState.collapse(path);
          } else {
            this._focusParent(path);
          }
          break;

        case 'Escape':
          e.preventDefault();
          this.host.focus();
          this.editorState.focusedPane = 'editor';
          break;
      }
    });
  }

  _setupDragAndDrop() {
    let draggedPath = null;
    let draggedIsDir = false;

    // Make items draggable
    this.fileTreeContainer.addEventListener('dragstart', (e) => {
      const el = e.target.closest('.file-item');
      if (!el || !el.dataset.path) return;

      draggedPath = el.dataset.path;
      draggedIsDir = el.dataset.isDir === 'true';

      // Set drag data
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedPath);

      // Add dragging class
      el.classList.add('dragging');

      // Set drag image
      const dragImage = el.cloneNode(true);
      dragImage.style.position = 'absolute';
      dragImage.style.top = '-1000px';
      dragImage.style.opacity = '0.8';
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 0, 0);
      setTimeout(() => dragImage.remove(), 0);
    });

    this.fileTreeContainer.addEventListener('dragend', (e) => {
      const el = e.target.closest('.file-item');
      if (el) {
        el.classList.remove('dragging');
      }
      draggedPath = null;
      draggedIsDir = false;

      // Remove all drop indicators
      this.fileTreeContainer.querySelectorAll('.drop-target').forEach(el => {
        el.classList.remove('drop-target');
      });
    });

    this.fileTreeContainer.addEventListener('dragover', (e) => {
      if (!draggedPath) return;

      const el = e.target.closest('.file-item');
      if (!el) return;

      const targetPath = el.dataset.path;
      const targetIsDir = el.dataset.isDir === 'true';

      // Can only drop on directories
      if (!targetIsDir) return;

      // Can't drop on self or into own children
      if (targetPath === draggedPath) return;
      if (draggedIsDir && targetPath.startsWith(draggedPath + '/')) return;

      // Can't drop into same parent (no-op)
      const draggedParent = draggedPath.substring(0, draggedPath.lastIndexOf('/'));
      if (targetPath === draggedParent) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Add drop target indicator
      this.fileTreeContainer.querySelectorAll('.drop-target').forEach(el => {
        el.classList.remove('drop-target');
      });
      el.classList.add('drop-target');
    });

    this.fileTreeContainer.addEventListener('dragleave', (e) => {
      const el = e.target.closest('.file-item');
      if (el) {
        el.classList.remove('drop-target');
      }
    });

    this.fileTreeContainer.addEventListener('drop', async (e) => {
      e.preventDefault();

      const el = e.target.closest('.file-item');
      if (!el) return;

      el.classList.remove('drop-target');

      const targetPath = el.dataset.path;
      const targetIsDir = el.dataset.isDir === 'true';

      if (!targetIsDir || !draggedPath) return;

      // Perform the move
      const result = await window.vomit.moveItem(draggedPath, targetPath);

      if (result.success && result.newPath) {
        // Update data model
        this.dataModel.moveNode(draggedPath, result.newPath, targetPath);

        // Expand target folder to show moved item
        if (!this.treeState.isExpanded(targetPath)) {
          await this._expandFolder(targetPath);
        }

        // Focus the moved item
        this.treeState.focusedPath = result.newPath;
      } else if (result.error) {
        alert(result.error);
      }
    });

    // Make file-items draggable when created (using MutationObserver)
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1 && node.classList?.contains('file-item')) {
            node.draggable = true;
          }
          // Also check children if it's a container
          if (node.nodeType === 1) {
            node.querySelectorAll?.('.file-item')?.forEach(item => {
              item.draggable = true;
            });
          }
        });
      });
    });

    observer.observe(this.fileTreeContainer, { childList: true, subtree: true });

    // Make existing items draggable
    this.fileTreeContainer.querySelectorAll('.file-item').forEach(item => {
      item.draggable = true;
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Folder operations
  // ─────────────────────────────────────────────────────────────

  async _toggleFolder(path) {
    if (this.treeState.isExpanded(path)) {
      this.treeState.collapse(path);
    } else {
      await this._expandFolder(path);
    }
    this.treeState.focusedPath = path;
  }

  async _expandFolder(path) {
    this.treeState.expand(path);

    // Load children if not loaded
    if (!this.dataModel.hasChildren(path)) {
      await this.dataModel.loadChildren(path);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // File selection
  // ─────────────────────────────────────────────────────────────

  _selectAndOpenFile(path) {
    this.treeState.focusAndSelect(path);
    this.editorState.focusedPane = 'sidebar';
    window.vomit.openFile(path);
    // Note: Tree stays visible. User must explicitly toggle to hide.
  }

  // ─────────────────────────────────────────────────────────────
  // Focus navigation
  // ─────────────────────────────────────────────────────────────

  _focusFirstOrSelected() {
    if (this.treeState.selectedPath) {
      this.treeState.focusedPath = this.treeState.selectedPath;
    } else {
      const visiblePaths = this.dataModel.getVisiblePaths(this.treeState.getExpandedPaths());
      if (visiblePaths.length > 0) {
        this.treeState.focusedPath = visiblePaths[0];
      }
    }
  }

  _focusNext(currentPath) {
    const visiblePaths = this.dataModel.getVisiblePaths(this.treeState.getExpandedPaths());
    const idx = visiblePaths.indexOf(currentPath);
    if (idx >= 0 && idx < visiblePaths.length - 1) {
      this.treeState.focusedPath = visiblePaths[idx + 1];
    }
  }

  _focusPrev(currentPath) {
    const visiblePaths = this.dataModel.getVisiblePaths(this.treeState.getExpandedPaths());
    const idx = visiblePaths.indexOf(currentPath);
    if (idx > 0) {
      this.treeState.focusedPath = visiblePaths[idx - 1];
    }
  }

  _focusParent(path) {
    const parentPath = this.dataModel.getParentPath(path);
    if (parentPath && parentPath !== this.treeState.rootPath) {
      this.treeState.focusedPath = parentPath;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Context menus
  // ─────────────────────────────────────────────────────────────

  setupFileTreeContextMenu() {
    const sidebarHeader = this.sidebarFiles.querySelector('.sidebar-header');
    if (sidebarHeader) {
      sidebarHeader.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.treeState.rootPath) {
          this._showRootContextMenu(e.clientX, e.clientY);
        }
      });
    }
  }

  _showRootContextMenu(x, y) {
    this._removeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'file-context-menu';
    menu.innerHTML = `
      <div class="context-menu-item" data-action="new-file">New File</div>
      <div class="context-menu-item" data-action="new-folder">New Folder</div>
    `;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);

    menu.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      // Use treeState.rootPath for root context menu (not currentDirectory which may be a subdirectory)
      const rootPath = this.treeState.rootPath;
      if (action === 'new-file') {
        this.createNewFile(rootPath);
      } else if (action === 'new-folder') {
        this.createNewFolder(rootPath);
      }
      menu.remove();
    });

    this._closeMenuOnOutsideClick(menu);
  }

  _showContextMenu(el, x, y) {
    this._removeContextMenu();
    const path = el.dataset.path;
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
      <div class="context-menu-item" data-action="open-default">Open with Default App</div>
      <div class="context-menu-item" data-action="finder">Show in Finder</div>
    `;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);

    menu.addEventListener('click', async (e) => {
      const action = e.target.dataset.action;
      const targetDir = isDir ? path : this._getParentPath(path);

      switch (action) {
        case 'new-file':
          this.createNewFile(targetDir);
          break;
        case 'new-folder':
          this.createNewFolder(targetDir);
          break;
        case 'rename':
          this._startRename(path);
          break;
        case 'delete':
          await this._deleteItem(path);
          break;
        case 'open-default':
          window.vomit.openWithDefault(path);
          break;
        case 'finder':
          window.vomit.showInFinder(path);
          break;
      }
      menu.remove();
    });

    this._closeMenuOnOutsideClick(menu);
  }

  _removeContextMenu() {
    const existing = document.querySelector('.file-context-menu');
    if (existing) existing.remove();
  }

  _closeMenuOnOutsideClick(menu) {
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  _getParentPath(path) {
    return path.substring(0, path.lastIndexOf('/'));
  }

  // ─────────────────────────────────────────────────────────────
  // Create new folder
  // ─────────────────────────────────────────────────────────────

  async createNewFolder(parentPath) {
    // Determine target: explicit path > focused item > root
    let targetDir = parentPath;

    if (!targetDir && this.treeState.focusedPath) {
      const focusedNode = this.dataModel.getNode(this.treeState.focusedPath);
      if (focusedNode) {
        // If focused on a directory, create inside it; otherwise create in parent
        targetDir = focusedNode.isDirectory ? focusedNode.path : focusedNode.parentPath;
      }
    }

    targetDir = targetDir || this.treeState.rootPath || this.editorState.currentDirectory;

    if (!targetDir) {
      alert('No folder open. Open a folder first.');
      return;
    }

    // Ensure parent is expanded and loaded
    if (targetDir !== this.treeState.rootPath) {
      await this._expandFolder(targetDir);
    }

    // Get container for inline input
    const container = this.treeView.ensureChildContainer(targetDir);

    // Get padding from sibling, or calculate if no siblings exist
    const sibling = container.querySelector('.file-item');
    let paddingLeft;
    if (sibling && sibling.style.paddingLeft) {
      paddingLeft = sibling.style.paddingLeft;
    } else {
      const depth = this._calculateDepth(targetDir) + 1;
      paddingLeft = `${8 + (depth * 16)}px`;
    }

    // Create inline input (match exact structure of real file-items)
    const inputContainer = document.createElement('div');
    inputContainer.className = 'file-item directory new-folder-input';
    inputContainer.style.paddingLeft = paddingLeft;
    inputContainer.innerHTML = `
      <span class="chevron" style="visibility: hidden;"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4"/></svg></span>
      <span class="icon"></span>
      <input type="text" class="rename-input" placeholder="folder name" value="New Folder">
    `;
    container.insertBefore(inputContainer, container.firstChild);

    const input = inputContainer.querySelector('input');
    input.focus();
    input.select();

    const finish = async (save) => {
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('keydown', onKeydown);

      if (save) {
        const name = input.value.trim();
        if (name) {
          const newPath = `${targetDir}/${name}`;
          try {
            await window.vomit.createDirectory(newPath);

            // Add to data model
            this.dataModel.addNode(newPath, {
              name,
              isDirectory: true,
              parentPath: targetDir
            });

            // Expand and focus the new folder
            this.treeState.expand(newPath);
            this.treeState.focusedPath = newPath;
          } catch (err) {
            console.error('Failed to create folder:', err);
            alert(`Failed to create folder: ${err.message || err}`);
          }
        }
      }

      inputContainer.remove();
    };

    const onBlur = () => finish(true);
    const onKeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };

    input.addEventListener('blur', onBlur);
    input.addEventListener('keydown', onKeydown);
  }

  // ─────────────────────────────────────────────────────────────
  // Create new file
  // ─────────────────────────────────────────────────────────────

  async createNewFile(parentPath) {
    // Determine target: explicit path > focused item > root
    let targetDir = parentPath;

    if (!targetDir && this.treeState.focusedPath) {
      const focusedNode = this.dataModel.getNode(this.treeState.focusedPath);
      if (focusedNode) {
        // If focused on a directory, create inside it; otherwise create in parent
        targetDir = focusedNode.isDirectory ? focusedNode.path : focusedNode.parentPath;
      }
    }

    targetDir = targetDir || this.treeState.rootPath || this.editorState.currentDirectory;

    if (!targetDir) {
      alert('No folder open. Open a folder first.');
      return;
    }

    // Ensure parent is expanded and loaded
    if (targetDir !== this.treeState.rootPath) {
      await this._expandFolder(targetDir);
    }

    // Get container for inline input
    const container = this.treeView.ensureChildContainer(targetDir);

    // Calculate indentation (child of targetDir)
    const depth = this._calculateDepth(targetDir) + 1;
    const indent = depth * 16;

    // Create inline input (match exact structure of real file-items)
    const inputContainer = document.createElement('div');
    inputContainer.className = 'file-item markdown new-file-input';
    inputContainer.style.paddingLeft = `${8 + indent}px`;
    inputContainer.innerHTML = `
      <span class="chevron" style="visibility: hidden;"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4"/></svg></span>
      <span class="icon"></span>
      <input type="text" class="rename-input" placeholder="filename.md" value="untitled.md">
    `;
    container.insertBefore(inputContainer, container.firstChild);

    const input = inputContainer.querySelector('input');
    input.focus();
    const dotIdx = input.value.lastIndexOf('.');
    if (dotIdx > 0) {
      input.setSelectionRange(0, dotIdx);
    } else {
      input.select();
    }

    const finish = async (save) => {
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('keydown', onKeydown);

      let newPath = null;

      if (save) {
        const name = input.value.trim();
        if (name) {
          newPath = `${targetDir}/${name}`;
          try {
            await window.vomit.writeFile(newPath, '');

            // Add to data model
            this.dataModel.addNode(newPath, {
              name,
              isDirectory: false,
              parentPath: targetDir
            });

            // Select and open the file
            this.treeState.focusAndSelect(newPath);
            window.vomit.openFile(newPath);
          } catch (err) {
            console.error('Failed to create file:', err);
            alert(`Failed to create file: ${err.message || err}`);
            newPath = null;
          }
        }
      }

      inputContainer.remove();

      // Focus editor for new file (tree stays visible)
      if (newPath) {
        this.host.focus();
      }
    };

    const onBlur = () => finish(true);
    const onKeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };

    input.addEventListener('blur', onBlur);
    input.addEventListener('keydown', onKeydown);
  }

  // ─────────────────────────────────────────────────────────────
  // Create new presentation
  // ─────────────────────────────────────────────────────────────

  async createNewPresentation(parentPath) {
    // Determine target: explicit path > focused item > root
    let targetDir = parentPath;

    if (!targetDir && this.treeState.focusedPath) {
      const focusedNode = this.dataModel.getNode(this.treeState.focusedPath);
      if (focusedNode) {
        // If focused on a directory, create inside it; otherwise create in parent
        targetDir = focusedNode.isDirectory ? focusedNode.path : focusedNode.parentPath;
      }
    }

    targetDir = targetDir || this.treeState.rootPath || this.editorState.currentDirectory;

    if (!targetDir) {
      alert('No folder open. Open a folder first.');
      return;
    }

    // Ensure parent is expanded and loaded
    if (targetDir !== this.treeState.rootPath) {
      await this._expandFolder(targetDir);
    }

    // Get container for inline input
    const container = this.treeView.ensureChildContainer(targetDir);

    // Calculate indentation (child of targetDir)
    const depth = this._calculateDepth(targetDir) + 1;
    const indent = depth * 16;

    // Create inline input (match exact structure of real file-items)
    const inputContainer = document.createElement('div');
    inputContainer.className = 'file-item markdown new-file-input';
    inputContainer.style.paddingLeft = `${8 + indent}px`;
    inputContainer.innerHTML = `
      <span class="chevron" style="visibility: hidden;"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4"/></svg></span>
      <span class="icon"></span>
      <input type="text" class="rename-input" placeholder="presentation.md" value="presentation.md">
    `;
    container.insertBefore(inputContainer, container.firstChild);

    const input = inputContainer.querySelector('input');
    input.focus();
    const dotIdx = input.value.lastIndexOf('.');
    if (dotIdx > 0) {
      input.setSelectionRange(0, dotIdx);
    }

    const finish = async (save) => {
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('keydown', onKeydown);

      if (save) {
        const name = input.value.trim();
        if (name) {
          const newPath = `${targetDir}/${name}`;
          try {
            const result = await window.vomit.createPresentationFile(newPath);
            if (!result.success) throw new Error(result.error);

            // Add to data model
            this.dataModel.addNode(newPath, {
              name,
              isDirectory: false,
              parentPath: targetDir
            });

            this.treeState.focusAndSelect(newPath);
          } catch (err) {
            console.error('Failed to create presentation:', err);
            alert(`Failed to create presentation: ${err.message || err}`);
          }
        }
      }

      inputContainer.remove();
      this.host.focus();
    };

    const onBlur = () => finish(true);
    const onKeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };

    input.addEventListener('blur', onBlur);
    input.addEventListener('keydown', onKeydown);
  }

  // ─────────────────────────────────────────────────────────────
  // Rename
  // ─────────────────────────────────────────────────────────────

  _startRename(path) {
    const el = this.treeView.getElement(path);
    if (!el) return;

    const node = this.dataModel.getNode(path);
    if (!node) return;

    const nameSpan = el.querySelector('.name');
    const currentName = node.name;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = currentName;

    nameSpan.style.display = 'none';
    el.appendChild(input);
    input.focus();
    input.select();

    const finish = async (save) => {
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('keydown', onKeydown);

      if (save) {
        const newName = input.value.trim();
        if (newName && newName !== currentName) {
          const result = await window.vomit.renameItem(path, newName);
          if (result.success && result.newPath) {
            this.dataModel.renameNode(path, result.newPath, newName);
            this.treeState.focusedPath = result.newPath;
            if (this.treeState.selectedPath === path) {
              this.treeState.selectedPath = result.newPath;
            }
          } else if (result.error) {
            alert(result.error);
          }
        }
      }

      input.remove();
      nameSpan.style.display = '';
    };

    const onBlur = () => finish(true);
    const onKeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    };

    input.addEventListener('blur', onBlur);
    input.addEventListener('keydown', onKeydown);
  }

  // ─────────────────────────────────────────────────────────────
  // Delete
  // ─────────────────────────────────────────────────────────────

  async _deleteItem(path) {
    const result = await window.vomit.deleteItem(path);

    if (result.success) {
      // Close tab if file was open
      if (this.tabManager) {
        const tab = this.tabManager.getTabByPath(path);
        if (tab) {
          this.tabManager.tabs.delete(tab.id);
          this.tabManager.tabOrder = this.tabManager.tabOrder.filter(id => id !== tab.id);

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

      // Get sibling or parent for focus
      const siblingPath = this.dataModel.getSibling(path, 'next') ||
                          this.dataModel.getSibling(path, 'prev') ||
                          this.dataModel.getParentPath(path);

      // Remove from data model
      this.dataModel.removeNode(path);

      // Update focus
      if (this.treeState.focusedPath === path) {
        this.treeState.focusedPath = siblingPath;
      }
      if (this.treeState.selectedPath === path) {
        this.treeState.selectedPath = null;
      }
    } else if (result.error) {
      alert(result.error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────────

  navigateToParent() {
    if (!this.editorState.currentDirectory) return;
    if (this.editorState.projectRoot && this.editorState.currentDirectory === this.editorState.projectRoot) return;

    const parts = this.editorState.currentDirectory.split('/');
    if (parts.length > 2) {
      const newDir = parts.slice(0, -1).join('/');
      if (this.editorState.projectRoot && !newDir.startsWith(this.editorState.projectRoot)) return;

      this.editorState.currentDirectory = newDir;
      this._ensureTreeLoaded().then(() => this._focusFirstOrSelected());
    }
  }

  // Calculate depth of a path relative to root (for indentation)
  _calculateDepth(path) {
    const rootPath = this.treeState.rootPath;
    if (!path || path === rootPath) return -1;
    if (!rootPath || !path.startsWith(rootPath)) return 0;

    const relativePath = path.slice(rootPath.length);
    return relativePath.split('/').filter(Boolean).length - 1;
  }
}

// Export for use in renderer
if (typeof window !== 'undefined') {
  window.FileTreeManager = FileTreeManager;
}

// CommandPaletteManager — Command palette overlay with fuzzy filtering.

class CommandPaletteManager {
  constructor({ host, getEditorActions }) {
    this.host = host;
    this._getEditorActions = getEditorActions;
  }

  async showCommandPalette() {
    // Remove existing palette if any
    const existing = document.querySelector('.command-palette');
    if (existing) {
      existing.remove();
      return;
    }

    const actions = this._getEditorActions();

    // Define all commands
    const commands = [
      // File commands
      { section: 'File', label: 'New Tab', shortcut: '⌘T', action: () => actions.tabManager.createTab(null, '') },
      { section: 'File', label: 'New Window', shortcut: '⌘⇧N', action: () => {} }, // Handled by main process
      { section: 'File', label: 'New File', shortcut: '⌘N', action: () => window.vomit.newFile() },
      { section: 'File', label: 'New Presentation', shortcut: '⌘⌥N', action: () => window.vomit.newPresentation() },
      { section: 'File', label: 'Open File', shortcut: '⌘O', action: () => window.vomit.openFileDialog() },
      { section: 'File', label: 'Open Folder', shortcut: '⌘⌥O', action: () => window.vomit.openFolderDialog() },
      { section: 'File', label: 'New Folder', shortcut: '⌘⇧F', action: () => actions.fileTreeManager.createNewFolder() },
      { section: 'File', label: 'New File in Folder', shortcut: '⌘⇧N', action: () => actions.fileTreeManager.createNewFile() },
      { section: 'File', label: 'Save', shortcut: '⌘S', action: () => window.vomit.saveContent(actions.getValue()) },
      { section: 'File', label: 'Save As', shortcut: '⌘⇧S', action: () => window.vomit.saveAs() },
      { section: 'File', label: 'Close Tab', shortcut: '⌘W', action: () => actions.tabManager.closeCurrentTab() },

      // View commands
      { section: 'View', label: 'Toggle Preview', shortcut: '⌘P', action: () => actions.previewManager.togglePreview() },
      { section: 'View', label: 'Toggle Files', shortcut: '⌘E', action: () => actions.fileTreeManager.toggleFileTree() },
      { section: 'View', label: 'Toggle Outline', shortcut: '⌘⇧O', action: () => actions.fileTreeManager.toggleOutline() },
      { section: 'View', label: 'Toggle Line Numbers', shortcut: '⌘L', action: () => actions.settingsManager.toggleLineNumbers() },
      { section: 'View', label: 'Toggle Word Wrap', shortcut: '⌥Z', action: () => actions.formatting.toggleLineWrapping() },
      { section: 'View', label: 'Find in File', shortcut: '⌘F', action: () => this.host.cm.execCommand('find') },
      { section: 'View', label: 'Find and Replace', shortcut: '⌘⌥F', action: () => this.host.cm.execCommand('replace') },
      { section: 'View', label: 'Search in Files', shortcut: '⌘⇧F', action: () => actions.searchManager.toggleSearch() },

      // Format commands
      { section: 'Format', label: 'Bold', shortcut: '⌘B', action: () => actions.formatting.wrapSelection('**', '**') },
      { section: 'Format', label: 'Italic', shortcut: '⌘I', action: () => actions.formatting.wrapSelection('*', '*') },
      { section: 'Format', label: 'Code', shortcut: '⌘`', action: () => actions.formatting.wrapSelection('`', '`') },
      { section: 'Format', label: 'Link', shortcut: '⌘K', action: () => actions.formatting.insertLink() },
      { section: 'Format', label: 'Insert Table', action: () => actions.formatting.insertTable() },
      { section: 'Format', label: 'Format Table', shortcut: '⌘⇧T', action: () => actions.formatting.formatTable() },
      { section: 'Format', label: 'Heading 1', shortcut: '⌘⇧1', action: () => actions.formatting.insertAtLineStart('# ') },
      { section: 'Format', label: 'Heading 2', shortcut: '⌘⇧2', action: () => actions.formatting.insertAtLineStart('## ') },
      { section: 'Format', label: 'Heading 3', shortcut: '⌘⇧3', action: () => actions.formatting.insertAtLineStart('### ') },
      { section: 'Format', label: 'Bullet List', shortcut: '⌘⇧8', action: () => actions.formatting.insertAtLineStart('- ') },
      { section: 'Format', label: 'Numbered List', shortcut: '⌘⇧9', action: () => actions.formatting.insertAtLineStart('1. ') },
      { section: 'Format', label: 'Quote', shortcut: "⌘'", action: () => actions.formatting.insertAtLineStart('> ') },
      { section: 'Format', label: 'Horizontal Rule', shortcut: '⌘-', action: () => actions.formatting.insertText('\n---\n') },
      { section: 'Format', label: 'Insert Slide', shortcut: '⌘↵', action: () => actions.formatting.insertSlide() },

      // Navigation
      { section: 'Navigation', label: 'Next Tab', shortcut: '⌘⇧]', action: () => actions.tabManager.nextTab() },
      { section: 'Navigation', label: 'Previous Tab', shortcut: '⌘⇧[', action: () => actions.tabManager.prevTab() },
      { section: 'Navigation', label: 'Go to Parent Folder', shortcut: '⌘↑', action: () => actions.fileTreeManager.navigateToParent() },

      // Presentation
      { section: 'Presentation', label: 'Start Presentation', shortcut: '⌘⇧P', action: () => window.vomit.startPresentation() },
      { section: 'Presentation', label: 'Start with Presenter View', shortcut: '⌘⌥P', action: () => window.vomit.startPresentationWithPresenter() },

      // Help
      { section: 'Help', label: 'Keyboard Shortcuts', shortcut: '⌘/', action: () => actions.settingsManager.showShortcutsModal() },
    ];

    // Get recent files
    let recentFiles = [];
    if (window.vomit && window.vomit.getRecentFiles) {
      recentFiles = await window.vomit.getRecentFiles();
    }

    // Add recent files as commands
    recentFiles.forEach(file => {
      commands.push({
        section: 'Recent Files',
        label: file.name,
        sublabel: file.path,
        action: () => window.vomit.openFile(file.path)
      });
    });

    // Create palette UI
    const palette = document.createElement('div');
    palette.className = 'command-palette';

    const content = document.createElement('div');
    content.className = 'command-palette-content';

    const input = document.createElement('input');
    input.className = 'command-palette-input';
    input.placeholder = 'Type a command or search...';

    const results = document.createElement('div');
    results.className = 'command-palette-results';

    content.appendChild(input);
    content.appendChild(results);
    palette.appendChild(content);
    document.body.appendChild(palette);

    let selectedIndex = 0;
    let filteredCommands = [...commands];

    const renderResults = () => {
      if (filteredCommands.length === 0) {
        results.innerHTML = '<div class="command-palette-empty">No matching commands</div>';
        return;
      }

      let html = '';
      let currentSection = '';

      filteredCommands.forEach((cmd, index) => {
        if (cmd.section !== currentSection) {
          currentSection = cmd.section;
          html += `<div class="command-palette-section">${currentSection}</div>`;
        }

        const selected = index === selectedIndex ? 'selected' : '';
        const shortcut = cmd.shortcut ? `<span class="shortcut">${cmd.shortcut}</span>` : '';
        html += `<div class="command-palette-item ${selected}" data-index="${index}">
          <span class="label">${cmd.label}</span>
          ${shortcut}
        </div>`;
      });

      results.innerHTML = html;

      // Add click handlers
      results.querySelectorAll('.command-palette-item').forEach(el => {
        el.addEventListener('click', () => {
          const idx = parseInt(el.dataset.index, 10);
          executeCommand(idx);
        });
      });

      // Scroll selected into view
      const selected = results.querySelector('.selected');
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    };

    const filterCommands = (query) => {
      if (!query.trim()) {
        filteredCommands = [...commands];
      } else {
        const q = query.toLowerCase();
        filteredCommands = commands.filter(cmd =>
          cmd.label.toLowerCase().includes(q) ||
          (cmd.section && cmd.section.toLowerCase().includes(q))
        );
      }
      selectedIndex = 0;
      renderResults();
    };

    const executeCommand = (index) => {
      const cmd = filteredCommands[index];
      if (cmd && cmd.action) {
        palette.remove();
        cmd.action();
        this.host.focus();
      }
    };

    const close = () => {
      palette.remove();
      this.host.focus();
    };

    // Event handlers
    input.addEventListener('input', () => filterCommands(input.value));

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, filteredCommands.length - 1);
        renderResults();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        renderResults();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executeCommand(selectedIndex);
      } else if (e.key === 'Escape') {
        close();
      }
    });

    palette.addEventListener('click', (e) => {
      if (e.target === palette) close();
    });

    // Initial render and focus
    renderResults();
    input.focus();
  }
}

# Changelog

All notable changes to Vomit will be documented in this file.

## [1.6.0] - 2026-04-09

### Added
- **Multi-bucket support** - Switch between multiple document folders via Buckets menu
- **Mermaid diagrams** - Render flowcharts, sequence diagrams, and more with configurable arrow styles
- **Split view** - Side-by-side editor and preview with scroll sync (`Cmd+\`)
- **Right outline bar** - Quick navigation through document headings
- **Drag-and-drop file tree** - Reorder files and folders by dragging
- **PyCharm-style multi-cursor** - `Cmd+G` to select next occurrence
- **Agent mode** - AI tool calling with `/agent` command
- **AI write commands** - `/write` to generate and insert content
- **/presentation command** - Start presentations from terminal
- **Search improvements** - Project-wide search with match highlighting in editor
- **Font size setting** - Adjustable editor font size
- **Code block shortcut** - Quick code fence insertion
- **Insert Date Heading** - `Cmd+Shift+D` inserts date as heading
- **Open with Default App** - Context menu option to open files externally
- **Update notifications** - Notifies when new version is available on startup
- **Open files outside bucket** - View files outside current bucket with warning toast
- **Version display** - Shows version and bucket icon in UI
- **Tabbed terminal panel** - AI and shell in separate tabs
- **AI conversation history** - Maintains context across prompts
- **Single file indexing** - Index individual files for RAG
- **Format Table** - Auto-format markdown tables
- **Toggle Word Wrap** - Toggle line wrapping in editor

### Changed
- **macOS only** - Removed Windows and Linux support for simplified maintenance
- **Major refactoring** - Modularized codebase (main.js 2400→137 lines, editor.js 3332→521 lines)
- **VS Code-inspired file tree** - Rewritten with better architecture
- File tree hidden by default (toggle with `Cmd+B`)
- Outside-bucket file warning now more prominent (top-right corner with amber styling)

### Fixed
- Scrolling issues when terminal panel is visible
- Line number left padding
- Double execution crash in file tree operations
- Image paste path for files in subdirectories
- Rename input navigation in file tree
- Search now searches entire project

## [1.5.5] - 2026-02-16

### Security
- Updated Electron from 28.0.0 to 40.4.1 (fixes ASAR integrity bypass)
- Updated electron-builder from 24.9.1 to 26.7.0 (fixes tar path traversal)
- Fixed lodash prototype pollution vulnerability

### Added
- MSI installer for Windows (alongside NSIS .exe)

## [1.5.4] - 2026-02-16

### Added
- **RAG (Retrieval Augmented Generation)** - Index your documents with `/index` and query with `/rag`
- **Pseudonymization** - Anonymize sensitive data with `/pseudo`, restore with `/depseudo`
- **Windows build support** - Windows installer via GitHub Actions (AI features not available)
- **GitHub Actions workflow** - Automated builds for macOS and Windows

### Changed
- Removed Claude CLI support, now Ollama-only
- AI features disabled on Windows due to native module dependencies

### Fixed
- EPIPE errors from console.log in Electron
- Dock icon size to match other macOS apps

## [1.5.3] - 2026-02-10

### Added
- **AI Terminal** - Built-in terminal powered by Ollama (`Cmd+J`)
- **Dynamic model detection** - Shows all installed Ollama models in AI menu
- `/doc` command to include document context in AI prompts

### Changed
- Terminal auto-shows when selecting a model from AI menu

### Fixed
- Removed debug console.log statements causing EPIPE errors

## [1.5.2] - 2026-02-05

### Added
- **Command Palette** - Quick access to all commands (`Cmd+.`)
- **Recent Files** - Track and quickly open recent files
- **Session Restore** - Restores last opened folder/file on startup
- **Tokyo Night theme**

## [1.5.1] - 2026-02-03

### Added
- **File watching** - Detect external file changes and prompt to reload
- **Auto-save toggle** - Enable/disable auto-save from File menu

## [1.5.0] - 2026-02-01

### Added
- **Tabs** - Multiple files in tabs (`Cmd+T` for new tab)
- **Multiple windows** - Open new editor windows (`Cmd+Shift+N`)

### Changed
- Improved keyboard navigation in file explorer

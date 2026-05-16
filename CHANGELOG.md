## [1.8.4](https://github.com/jacqinthebox/vomit-vnext/compare/v1.8.3...v1.8.4) (2026-05-16)


### Bug Fixes

* **editor:** preserve markdown formatting when pasting ([fb9c286](https://github.com/jacqinthebox/vomit-vnext/commit/fb9c286c3cc654a83132486636199dd6602db39d))
* **pseudo:** improve pseudonymization with GUID support and case handling ([86ee47c](https://github.com/jacqinthebox/vomit-vnext/commit/86ee47cfc50dfdb35a2add223fff3a84baad13e4))

## [1.8.3](https://github.com/jacqinthebox/vomit-vnext/compare/v1.8.2...v1.8.3) (2026-04-12)


### Bug Fixes

* **editor:** improve code block styling and outline parsing ([31128cf](https://github.com/jacqinthebox/vomit-vnext/commit/31128cfa48ca93079aa8f10893728128e7d78268))

## [1.8.2](https://github.com/jacqinthebox/vomit-vnext/compare/v1.8.1...v1.8.2) (2026-04-11)


### Bug Fixes

* **tree:** add file type icons for all common extensions ([c4c4567](https://github.com/jacqinthebox/vomit-vnext/commit/c4c4567beaaa82560fcf43a76fb533f040d0a97a))

## [1.8.1](https://github.com/jacqinthebox/vomit-vnext/compare/v1.8.0...v1.8.1) (2026-04-11)


### Bug Fixes

* **tabs:** correct method name for inline image updates ([df71e3e](https://github.com/jacqinthebox/vomit-vnext/commit/df71e3e668fe8cdc59c3408dacd5550e50d55650))

# [1.8.0](https://github.com/jacqinthebox/vomit-vnext/compare/v1.7.0...v1.8.0) (2026-04-10)


### Features

* **editor:** add inline preview for LaTeX, Mermaid, and PlantUML ([380274f](https://github.com/jacqinthebox/vomit-vnext/commit/380274f6fddbb2f9da74d34fcc5c4f5c2fcda13a))

# [1.7.0](https://github.com/jacqinthebox/vomit-vnext/compare/v1.6.14...v1.7.0) (2026-04-10)


### Bug Fixes

* **editor:** simplify inline image widget styling ([d03b0a7](https://github.com/jacqinthebox/vomit-vnext/commit/d03b0a7f4fd3ac35c7d7304b9853431b83711618))
* search highlight now works for files already open in tabs ([12be4a4](https://github.com/jacqinthebox/vomit-vnext/commit/12be4a4158c83a9b7ec50d262856c74ac99403a1))


### Features

* **editor:** add inline image preview in editor ([b905d0c](https://github.com/jacqinthebox/vomit-vnext/commit/b905d0c45f4db67b39ba8edd380f06f2fe5fcc03))

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

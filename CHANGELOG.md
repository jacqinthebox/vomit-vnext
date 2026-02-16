# Changelog

All notable changes to Vomit will be documented in this file.

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
- **CLI launcher** - Open files/folders from terminal with `vomit` command

### Changed
- Improved keyboard navigation in file explorer

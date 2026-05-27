# [1.12.0](https://github.com/jacqinthebox/vomit-vnext/compare/v1.11.4...v1.12.0) (2026-05-27)


### Features

* **wiki:** obsidian-style wikilinks, backlinks, graph + UI polish ([435d082](https://github.com/jacqinthebox/vomit-vnext/commit/435d0827e1a3320a582de75e97c0db0ba43a171c)), closes [#heading](https://github.com/jacqinthebox/vomit-vnext/issues/heading)

## [1.11.4](https://github.com/jacqinthebox/vomit-vnext/compare/v1.11.3...v1.11.4) (2026-05-19)


### Bug Fixes

* **terminal:** allow terminal pane to resize to full window height ([5c0e71b](https://github.com/jacqinthebox/vomit-vnext/commit/5c0e71b6e787ae242d0062546d64252aa83a6ee8))

## [1.11.3](https://github.com/jacqinthebox/vomit-vnext/compare/v1.11.2...v1.11.3) (2026-05-18)


### Bug Fixes

* **images:** trigger release for vomit-file protocol image fix ([e1044fd](https://github.com/jacqinthebox/vomit-vnext/commit/e1044fd4110b206240932be510476429e083f0ca))

## [1.11.2](https://github.com/jacqinthebox/vomit-vnext/compare/v1.11.1...v1.11.2) (2026-05-18)


### Bug Fixes

* **images:** use custom vomit-file:// protocol for local image loading in packaged app ([f87d622](https://github.com/jacqinthebox/vomit-vnext/commit/f87d6221462f2761001ab8353d70562ae2f3d6a1))

## [1.11.1](https://github.com/jacqinthebox/vomit-vnext/compare/v1.11.0...v1.11.1) (2026-05-18)


### Bug Fixes

* **terminal:** add thinking indicator for AI processing ([2b196d9](https://github.com/jacqinthebox/vomit-vnext/commit/2b196d9ff5495feac1942158159c36ef95526814))

# [1.11.0](https://github.com/jacqinthebox/vomit-vnext/compare/v1.10.3...v1.11.0) (2026-05-18)


### Features

* **ai:** unified agent mode with streaming and context health bar ([6d818d5](https://github.com/jacqinthebox/vomit-vnext/commit/6d818d5bc3e0e31c271dc906aa29a614d7737969))

## [1.10.3](https://github.com/jacqinthebox/vomit-vnext/compare/v1.10.2...v1.10.3) (2026-05-18)


### Bug Fixes

* **filetree:** fix DOM ordering after refresh and remove addNode optimistic updates ([cc0f8ef](https://github.com/jacqinthebox/vomit-vnext/commit/cc0f8ef216e224a48880b4793880d3193c01324d))
* **filetree:** use chokidar for reliable refresh, invalidate changed folder only ([0d41bb9](https://github.com/jacqinthebox/vomit-vnext/commit/0d41bb975c10514051bcdd10fc1eb0e878f83dfd))

## [1.10.2](https://github.com/jacqinthebox/vomit-vnext/compare/v1.10.1...v1.10.2) (2026-05-17)


### Bug Fixes

* **filetree:** add View menu toggle to show/hide images folder ([45cdc93](https://github.com/jacqinthebox/vomit-vnext/commit/45cdc9395e7468e75c8b7517f028e220631c3cab))

## [1.10.1](https://github.com/jacqinthebox/vomit-vnext/compare/v1.10.0...v1.10.1) (2026-05-17)


### Bug Fixes

* **filetree:** hide images folder from file tree ([283b1d8](https://github.com/jacqinthebox/vomit-vnext/commit/283b1d87a0c951b4b5568215cf812d46a551c186))

# [1.10.0](https://github.com/jacqinthebox/vomit-vnext/compare/v1.9.3...v1.10.0) (2026-05-17)


### Bug Fixes

* **agent:** inject current date into system prompt ([76b8f5d](https://github.com/jacqinthebox/vomit-vnext/commit/76b8f5d6d16fd5a082167e8c3c0e7764e15f8872))
* **agent:** instruct model to use tavily_search for internet queries ([42b960b](https://github.com/jacqinthebox/vomit-vnext/commit/42b960b3c3f43bd4e4bcd99322ffae384f87a322))
* **menu:** use osascript for Tavily API key dialog ([96d3acd](https://github.com/jacqinthebox/vomit-vnext/commit/96d3acda8f6b072ea4dba97ed2d1cf9c83b1fa11))
* **rag:** /index defaults to current file's directory, not bucket root ([9856976](https://github.com/jacqinthebox/vomit-vnext/commit/9856976b9a9376838f6e1d7c2905491c3ec1e086))
* **rag:** show clear error when /index subfolder does not exist ([3f93f4e](https://github.com/jacqinthebox/vomit-vnext/commit/3f93f4eefb65d14b6faed2881c030f00c979bda0))
* **terminal:** enter completes picker selection and restore /help line breaks ([d1ae70c](https://github.com/jacqinthebox/vomit-vnext/commit/d1ae70cfa34df1c36a06b0eb2c4cc87bb679c27c))
* **terminal:** Enter executes optional-args commands immediately from picker ([006c1c1](https://github.com/jacqinthebox/vomit-vnext/commit/006c1c18d84ee4b61c8225de81329c031d87cb95))
* **terminal:** make picker render as plain terminal output, not styled block ([b5e8417](https://github.com/jacqinthebox/vomit-vnext/commit/b5e84176d512a1b6b2296766de84494aca0f3785))
* **terminal:** scroll selected picker item into view on navigation ([e8c5951](https://github.com/jacqinthebox/vomit-vnext/commit/e8c5951570795c78148685d79ce134025384e57d))
* **terminal:** sort picker commands alphabetically ([c56334f](https://github.com/jacqinthebox/vomit-vnext/commit/c56334f81cb14cfd477be39a9aa4203f6e9005df))


### Features

* **terminal:** persist command history across restarts ([889a58b](https://github.com/jacqinthebox/vomit-vnext/commit/889a58bf8030e9bbb110cebf2b2b181351a9b9b5))

## [1.9.3](https://github.com/jacqinthebox/vomit-vnext/compare/v1.9.2...v1.9.3) (2026-05-17)


### Bug Fixes

* **terminal:** surface command policy violations and clean up handlers ([f4263de](https://github.com/jacqinthebox/vomit-vnext/commit/f4263defd24d7d4bd164812f805ffe402daf5a4d))

## [1.9.2](https://github.com/jacqinthebox/vomit-vnext/compare/v1.9.1...v1.9.2) (2026-05-17)


### Bug Fixes

* **terminal:** extract command registry and add Tavily API key menu ([8142d64](https://github.com/jacqinthebox/vomit-vnext/commit/8142d641657f49c9fa3de92f42429b850187be70))

## [1.9.1](https://github.com/jacqinthebox/vomit-vnext/compare/v1.9.0...v1.9.1) (2026-05-16)


### Bug Fixes

* **editor:** prioritize text over images when pasting from Word ([409afad](https://github.com/jacqinthebox/vomit-vnext/commit/409afad38c78d97a0464b14df3c2d434915be697))

# [1.9.0](https://github.com/jacqinthebox/vomit-vnext/compare/v1.8.5...v1.9.0) (2026-05-16)


### Features

* **agent:** add Tavily internet search capability ([292378f](https://github.com/jacqinthebox/vomit-vnext/commit/292378f72bc414df7a22ed778274401d39d509d0))

## [1.8.5](https://github.com/jacqinthebox/vomit-vnext/compare/v1.8.4...v1.8.5) (2026-05-16)


### Bug Fixes

* **editor:** improve paste handling, auto-save, and folder move refresh ([132016b](https://github.com/jacqinthebox/vomit-vnext/commit/132016b445f1a6bb70693c6e2147ef1ec4a3ef6f))

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

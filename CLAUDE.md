# CLAUDE.md - Context for Claude Code

## Project Overview

Vomit is a keyboard-centric markdown editor and presentation app built with Electron (macOS/Linux only). It features live preview, presenter view with speaker notes, and an integrated AI terminal powered by Ollama.

## Tech Stack

- **Electron 40.x** - Desktop app framework
- **CodeMirror 5** - Editor with syntax highlighting (GFM mode)
- **Marked** - Markdown parsing
- **Highlight.js** - Code block highlighting
- **KaTeX** - LaTeX math rendering
- **PlantUML** - Diagram rendering
- **better-sqlite3** - SQLite for RAG vector storage
- **node-pty** - PTY support for Ollama terminal
- **xterm.js** - Terminal emulator in renderer
- **electron-store** - Preferences persistence

## Architecture

The codebase follows a modular architecture with clear separation of concerns:

### Main Process (`src/main/`)

```
src/main/
├── main.js                    # App lifecycle orchestrator (137 lines)
├── preload.js                 # Context bridge — exposes window.vomit.* API
├── menu.js                    # Application menu + AI model submenu
├── rag.js                     # RAG indexing, embeddings, vector search
├── services/
│   ├── configStore.js         # electron-store wrapper for preferences
│   ├── sessionState.js        # Shared mutable state (EventEmitter)
│   └── windowManager.js       # Window creation (main, presentation, presenter, about)
└── ipc/
    ├── rendererBus.js         # Centralized mainWindow.webContents.send() wrapper
    └── handlers/
        ├── file.js            # File operations + 20 IPC handlers
        ├── ai.js              # AI detection, Ollama execution
        ├── agent.js           # Agent tools and execution
        ├── shell.js           # Shell spawn/write/stop/resize
        └── presentation.js    # Presentation, PDF export, themes, format commands
```

### Renderer Process (`src/renderer/`)

```
src/renderer/
├── index.html                 # Main window HTML + script load order
├── js/
│   ├── editor.js              # Orchestrator — wires all managers, routes IPC (521 lines)
│   ├── tabs.js                # Tab management
│   ├── hints.js               # Autocomplete hints
│   ├── emoji.js               # Emoji shortcode support
│   ├── state/
│   │   └── editorState.js     # EventTarget-based state container (27 properties)
│   ├── hosts/
│   │   └── codemirrorHost.js  # CodeMirror 5 wrapper (content, selection, cursor APIs)
│   └── features/
│       ├── terminal.js        # Terminal, shell, AI commands, pseudonymization, RAG UI
│       ├── fileTree.js        # File tree rendering, navigation, context menus, CRUD
│       ├── preview.js         # Markdown preview, frontmatter, outline
│       ├── settings.js        # Auto-save, sidebar resize, shortcuts modal
│       ├── commandPalette.js  # Command palette with fuzzy filter
│       ├── formatting.js      # Text formatting (bold, italic, links, tables)
│       └── search.js          # Search across files
└── css/
    ├── styles.css             # Main styles
    └── themes.css             # Theme definitions
```

### Key Patterns

- **Dependency injection**: Feature modules receive deps via constructor — `new TerminalManager({ state, host, dom, getTabManager })`
- **Lazy getter pattern**: Cross-module refs use `get tabManager() { return this._getTabManager(); }` to avoid circular init order issues
- **IPC handler registration**: `registerHandlers(ipcMain, { state, bus, configStore })` pattern for all main process modules
- **EditorState**: EventTarget-based state container with getters/setters that fire `change` and `change:propertyName` events
- **CodemirrorHost**: Thin wrapper around CM5 with clean API; `raw` getter as escape hatch
- **Script load order** (critical): editorState → codemirrorHost → features → tabs → editor

## Key Features

### AI Terminal (Ollama)
- Toggle with `Cmd+J`
- Commands: `/doc`, `/pseudo`, `/depseudo`, `/index`, `/rag`, `/agent`
- Models detected from local Ollama installation via direct path checks

### RAG (Retrieval Augmented Generation)
- `/index` - Index all documents using nomic-embed-text embeddings
- `/index subfolder` - Index specific subfolder only
- `/rag <query>` - Search indexed docs and query AI with context
- Database stored in `~/.config/vomit/rag/<project>-<hash>.db`
- Uses cosine similarity for vector search

### Presentation Mode
- `Cmd+Shift+P` - Start presentation
- `Cmd+Alt+P` - Start with presenter view
- Speaker notes after `???` in slides
- Slides separated by `---`

## Development

```bash
npm install          # Install dependencies
npm start            # Run in development
```

## Building & Releasing

**Local build (Mac only):**
```bash
npx electron-builder --mac --dir    # Build .app only (recommended)
```

The built app will be at `dist/mac-arm64/Vomit.app`.

**DO NOT build DMG locally** - The DMG builder often fails with "disk busy" errors. Use `--dir` flag to build just the .app file.

**DO NOT run `npm run build`** - It tries to build for all platforms and fails on macOS due to Wine/32-bit issues.

**Release process:**
1. Build locally: `npx electron-builder --mac --dir`
2. Commit and push changes
3. DMG and cross-platform builds are handled by GitHub Actions CI

## Important Guidelines

1. **DO NOT push before the user has tested the changes** - Always let the user verify the app works before committing/pushing.

2. **Update documentation after changes** - After every feature change, update:
   - `README.md` - Features, comparison table, usage instructions
   - `SHORTCUTS.md` - If any keyboard shortcuts changed

3. **Ollama detection** - Uses direct path checks (`/opt/homebrew/bin/ollama`, `/usr/local/bin/ollama`) because packaged Electron apps have restricted PATH.

4. **No console.log in main.js** - Causes EPIPE errors in Electron. Remove debug logs before committing.

5. **IPC pattern** - Main process handlers in `src/main/ipc/handlers/`, bridges in `preload.js`, renderer calls via `window.vomit.*`

6. **RAG embeddings** - Requires `ollama pull nomic-embed-text` to be installed.

7. **macOS/Linux only** - Windows support was removed. No platform checks needed.

## Recent Changes

- **Major refactor**: Modularized monolithic main.js (2400→137 lines) and editor.js (3332→521 lines)
- Extracted 5 main process handler modules, 3 services, 7 renderer feature modules
- Added EditorState (centralized state) and CodemirrorHost (CM5 wrapper)
- Removed Windows support entirely
- Removed Claude CLI support, now Ollama-only
- Added RAG with SQLite storage in ~/.config/vomit/rag/

# CLAUDE.md - Context for Claude Code

## Project Overview

Vomit is a keyboard-centric markdown editor and presentation app built with Electron. It features live preview, presenter view with speaker notes, and an integrated AI terminal powered by Ollama.

## Tech Stack

- **Electron** - Desktop app framework
- **CodeMirror 5** - Editor with syntax highlighting
- **Marked** - Markdown parsing
- **Highlight.js** - Code block highlighting
- **KaTeX** - LaTeX math rendering
- **PlantUML** - Diagram rendering
- **better-sqlite3** - SQLite for RAG vector storage
- **node-pty** - PTY support for Ollama terminal

## Project Structure

```
src/
├── main/
│   ├── main.js        # Main process - IPC handlers, menus, Ollama, RAG
│   └── preload.js     # Context bridge - exposes APIs to renderer
└── renderer/
    ├── index.html     # Main window HTML
    ├── js/
    │   ├── editor.js  # Main editor class - tabs, terminal, preview
    │   ├── tabs.js    # Tab management
    │   ├── hints.js   # Autocomplete hints
    │   └── emoji.js   # Emoji shortcode support
    └── css/
        ├── styles.css # Main styles
        └── themes.css # Theme definitions
```

## Key Features

### AI Terminal (Ollama) — macOS/Linux Only
- Toggle with `Cmd+J`
- Commands: `/doc`, `/pseudo`, `/depseudo`, `/index`, `/rag`, `/agent`
- Models detected from local Ollama installation
- **Not available on Windows** due to node-pty dependencies

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

3. **Ollama detection** - Uses direct path checks (`/opt/homebrew/bin/ollama`, `/usr/local/bin/ollama`) because packaged Electron apps have restricted PATH. AI features are disabled on Windows.

4. **No console.log in main.js** - Causes EPIPE errors in Electron. Remove debug logs before committing.

5. **IPC pattern** - Main process handlers in `main.js`, bridges in `preload.js`, renderer calls via `window.vomit.*`

6. **RAG embeddings** - Requires `ollama pull nomic-embed-text` to be installed.

## Recent Changes

- Removed Claude CLI support, now Ollama-only
- Added RAG with SQLite storage in ~/.config/vomit/rag/
- Added subfolder indexing support
- Terminal auto-shows when selecting a model from AI menu
- Folder name shown in sidebar header
- **Windows build now excludes AI features** (node-pty not supported)

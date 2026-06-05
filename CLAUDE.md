# CLAUDE.md - Context for Claude Code

## Project Overview

Vomit is a keyboard-centric markdown editor and presentation app built with Electron for macOS, Linux, and Windows. It features live preview, presenter view with speaker notes, and an integrated AI terminal powered by Ollama.

## Tech Stack

- **Electron 41.x** - Desktop app framework
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
│   ├── editor.js              # Orchestrator — wires all managers, routes IPC
│   ├── pathUtils.js           # Separator-tolerant renderer path/url helpers
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
- **Script load order** (critical): pathUtils → editorState → codemirrorHost → features → tabs → editor
- **Shortcut labels**: Use platform-aware labels in renderer UI (`Cmd` on macOS, `Ctrl` on Windows/Linux; `Option` on macOS, `Alt` elsewhere). Electron menu accelerators should use `CmdOrCtrl`.

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

**Local build (Mac):**
```bash
npx electron-builder --mac --dir    # Build .app only (recommended)
```

The built app will be at `dist/mac-arm64/Vomit.app`.

**DO NOT build DMG locally** - The DMG builder often fails with "disk busy" errors. Use `--dir` flag to build just the .app file.

**Local build (Windows):**
```bash
npm run build:win
```

Windows artifacts are produced in `dist/`. The CI Windows build runs on `windows-latest`; prefer CI for validating native module rebuilds (`better-sqlite3`, `node-pty`) when working from macOS.

**DO NOT run `npm run build` for cross-platform validation** - It is mac-only by design. Use `npm run build:mac` on macOS and `npm run build:win` on Windows/CI.

### Automated Releases (semantic-release)

Releases are fully automated via semantic-release. On every push to main:

1. Analyzes commits since last release
2. Determines version bump based on commit types
3. Updates `CHANGELOG.md` automatically
4. Bumps version in `package.json`
5. Creates git tag and GitHub Release
6. Build workflow attaches macOS DMG and Windows artifacts to the release

**Commit types and version bumps:**

| Commit type | Version bump | Example |
|-------------|--------------|---------|
| `fix:` | Patch (1.6.14 → 1.6.15) | `fix: resolve crash` |
| `feat:` | Minor (1.6.14 → 1.7.0) | `feat: add dark mode` |
| `feat!:` or `BREAKING CHANGE:` | Major (1.6.14 → 2.0.0) | `feat!: new API` |
| `chore:`, `docs:`, `refactor:` | No release | `chore: update deps` |

**DO NOT manually edit version in package.json** - semantic-release manages this.

**DO NOT manually edit CHANGELOG.md** - semantic-release generates it from commits.

### Pre-Push Workflow (Manual Version Bump)

**IMPORTANT**: Before pushing changes, follow these steps to avoid update popups during local testing:

1. **Determine change type**:
   - `fix:` = Bug fix, UI improvement, performance fix → Patch bump (1.11.0 → 1.11.1)
   - `feat:` = New feature, new command, new capability → Minor bump (1.11.0 → 1.12.0)
   - `feat!:` = Breaking change → Major bump (1.11.0 → 2.0.0)

2. **Manually bump version in package.json**:
   ```bash
   # For fix: 1.11.0 → 1.11.1
   # For feat: 1.11.0 → 1.12.0
   ```

3. **Build the app**:
   ```bash
   npx electron-builder --mac --dir
   ```

4. **Test the built app** at `dist/mac-arm64/Vomit.app`:
   - Verify the feature works
   - Check version in About dialog
   - Ensure no update popup appears

5. **Commit with semantic-release format**:
   ```bash
   git add .
   git commit -m "fix(scope): short description

   - Detailed change 1
   - Detailed change 2

   🤖 Generated with [Claude Code](https://claude.com/claude-code)

   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
   ```

6. **Push to main**:
   ```bash
   git push
   ```
   - semantic-release will see the version already matches the commit type
   - GitHub Actions will build and attach DMG to the release

7. **After semantic-release completes, sync and rebuild locally**:
   ```bash
   git pull --ff-only
   npx electron-builder --mac --dir
   ```
   - Required after every `fix:`/`feat:` push because semantic-release creates a follow-up `chore(release): <version>` commit that updates `package.json`
   - Do not tell the user to test/use the local app until this post-release rebuild is done
   - This prevents local builds from showing "Update available" popups (for example, local app `1.13.1` while latest release is `1.13.2`)

**Why manual version bump?** This prevents the update popup during local testing. The version in the built app matches the next release version, so the app won't prompt for an update.

## Important Guidelines

1. **DO NOT push before the user has tested the changes** - Always let the user verify the app works before committing/pushing.

2. **Update documentation after changes** - After every feature change, update:
   - `README.md` - Features, comparison table, usage instructions
   - `SHORTCUTS.md` - If any keyboard shortcuts changed

3. **Ollama detection** - Uses direct path checks plus platform executable lookup because packaged Electron apps have restricted PATH. Include Windows `.exe` locations when adding tool detection.

4. **No console.log in main.js** - Causes EPIPE errors in Electron. Remove debug logs before committing.

5. **IPC pattern** - Main process handlers in `src/main/ipc/handlers/`, bridges in `preload.js`, renderer calls via `window.vomit.*`

6. **RAG embeddings** - Requires `ollama pull nomic-embed-text` to be installed.

7. **Cross-platform paths** - Renderer code receives native paths from main. Use `window.PathUtils` for basename/dirname/join/subpath checks and `toVomitFileUrl()` for local preview URLs. Do not split paths on `'/'` or build `vomit-file://` URLs with string concatenation.

8. **Windows support** - Keep runtime integrations platform-aware: shell defaults to PowerShell/cmd on Windows, app file-open uses argv/single-instance handling, RAG must use JS HTTP/fetch rather than shell `curl`, and menu prompts must stay Electron-based rather than AppleScript.

## Recent Changes

- **Major refactor**: Modularized monolithic main.js (2400→137 lines) and editor.js (3332→521 lines)
- Extracted 5 main process handler modules, 3 services, 7 renderer feature modules
- Added EditorState (centralized state) and CodemirrorHost (CM5 wrapper)
- Removed Windows support entirely
- Removed Claude CLI support, now Ollama-only
- Added RAG with SQLite storage in ~/.config/vomit/rag/

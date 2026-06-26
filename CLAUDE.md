# CLAUDE.md - Context for Claude Code

## Project Overview

Vomit is a keyboard-centric markdown editor and presentation app built with Electron for **macOS, Linux, and Windows**. It features live preview, presenter view with speaker notes, and an integrated AI terminal powered by Ollama. All three platforms are first-class — keep features and builds working everywhere.

## Tech Stack

- **Electron 41.x** — desktop app framework
- **CodeMirror 5** — editor (GFM mode), with **Marked** (parsing), **Highlight.js** (code), **KaTeX** (math), **PlantUML** (diagrams)
- **better-sqlite3** — SQLite for RAG vector storage
- **node-pty** + **xterm.js** — Ollama terminal
- **electron-store** — preferences persistence

## Architecture

Modular, with clear separation of concerns.

### Main process (`src/main/`)
- `main.js` — app lifecycle orchestrator; `preload.js` — context bridge (`window.vomit.*`); `menu.js` — app menu + AI model submenu; `rag.js` — indexing, embeddings, vector search
- `services/` — `configStore.js` (prefs), `sessionState.js` (shared state), `windowManager.js` (windows)
- `ipc/` — `rendererBus.js` + `handlers/` (`file.js`, `ai.js`, `agent.js`, `shell.js`, `presentation.js`)

### Renderer process (`src/renderer/`)
- `js/editor.js` — orchestrator wiring managers + routing IPC; `pathUtils.js`, `tabs.js`, `hints.js`, `emoji.js`
- `js/state/editorState.js` — EventTarget state container; `js/hosts/codemirrorHost.js` — CM5 wrapper
- `js/features/` — `terminal.js`, `fileTree.js`, `preview.js`, `settings.js`, `commandPalette.js`, `formatting.js`, `search.js`
- `css/` — `styles.css`, `themes.css`

### Key patterns
- **Dependency injection** via constructor: `new TerminalManager({ state, host, dom, getTabManager })`
- **Lazy getters** for cross-module refs to avoid circular init order
- **IPC registration**: `registerHandlers(ipcMain, { state, bus, configStore })`
- **EditorState**: fires `change` / `change:propertyName` events; **CodemirrorHost**: clean CM5 API with `raw` escape hatch
- **Script load order** (critical): pathUtils → editorState → codemirrorHost → features → tabs → editor
- **Shortcut labels**: platform-aware in renderer UI (`Cmd`/`Option` on macOS, `Ctrl`/`Alt` elsewhere); menu accelerators use `CmdOrCtrl`

## Key Features

- **AI Terminal (Ollama)** — toggle `Cmd+J`; commands `/doc`, `/pseudo`, `/depseudo`, `/index`, `/rag`, `/agent`; models detected via direct path checks
- **RAG** — `/index [subfolder]` builds embeddings (nomic-embed-text), `/rag <query>` searches + queries AI; DB in `~/.config/vomit/rag/<project>-<hash>.db` (cosine similarity)
- **Presentation** — `Cmd+Shift+P` present, `Cmd+Alt+P` presenter view; slides split on `---`, speaker notes after `???`

## Development

```bash
npm install   # install dependencies
npm start     # run in development
```

## Building & Releasing

**All platforms are important — validate macOS and Windows builds.**

| Platform | Command | Output |
|----------|---------|--------|
| macOS    | `npx electron-builder --mac --dir` | `dist/mac-arm64/Vomit.app` |
| Windows  | `npm run build:win` | `dist/` |

- **DO NOT build DMG locally** — fails with "disk busy". Use `--dir` for the `.app` only.
- **DO NOT run `npm run build`** for cross-platform validation — it is mac-only. Use `build:mac` / `build:win`.
- Prefer CI (`windows-latest`) to validate native module rebuilds (`better-sqlite3`, `node-pty`) from macOS.

### Versioning & release pipeline (semantic-release + semver)

The pipeline uses **semantic versioning**. On every push to `main`, semantic-release analyzes commits, generates `CHANGELOG.md`, tags, and creates a GitHub Release; the build workflow then attaches **macOS and Windows** artifacts.

| Commit type | Bump | Example |
|-------------|------|---------|
| `fix:` | patch (1.6.14 → 1.6.15) | `fix: resolve crash` |
| `feat:` | minor (1.6.14 → 1.7.0) | `feat: add dark mode` |
| `feat!:` / `BREAKING CHANGE:` | major (1.6.14 → 2.0.0) | `feat!: new API` |
| `chore:`, `docs:`, `refactor:` | none | `chore: update deps` |

- **Increment the version in `package.json` before pushing.** Bump it to match the commit type (patch for `fix:`, minor for `feat:`, major for `feat!:`) so the locally built/tested app matches the version about to be released and no "Update available" popup appears.
- Do not hand-edit `CHANGELOG.md` — semantic-release generates it.
- **After the release lands, sync and rebuild**: `git pull --ff-only && npx electron-builder --mac --dir`. Semantic-release pushes a follow-up `chore(release): <version>` commit; rebuild before telling the user to test the local app.

**Where the version comes from (why the popup appears):** the status-bar version (`#status-version`, set in `editor.js` via the `get-app-version` IPC) and the update check (`checkForUpdates()` in `main.js`) both read `app.getVersion()` — i.e. the `version` field baked into `package.json` at build time. There is no separate UI version to update. The "Update available" popup fires whenever the running build's `package.json` version is older than the latest GitHub release tag, which happens if you push without bumping, or if you skip the post-release rebuild (semantic-release's `chore(release)` commit leaves the local build one version behind).

## Important Guidelines

1. **Do not push before the user has tested the changes.**
2. **Update docs after changes** — `README.md` (features, comparison, usage) and `SHORTCUTS.md` (if shortcuts changed).
3. **Windows support** — keep integrations platform-aware: shell defaults to PowerShell/cmd, app file-open uses argv/single-instance, RAG uses JS HTTP/fetch (not shell `curl`), menu prompts stay Electron-based (not AppleScript). Include Windows `.exe` locations in tool/Ollama detection.
4. **Ollama detection** — direct path checks + platform executable lookup (packaged apps have restricted PATH).
5. **No `console.log` in main.js** — causes EPIPE errors in Electron.
6. **IPC pattern** — handlers in `src/main/ipc/handlers/`, bridges in `preload.js`, renderer calls via `window.vomit.*`.
7. **RAG embeddings** — require `ollama pull nomic-embed-text`.
8. **Cross-platform paths** — use `window.PathUtils` (basename/dirname/join/subpath) and `toVomitFileUrl()` for preview URLs. Never split paths on `'/'` or concatenate `vomit-file://` URLs.

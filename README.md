# Vomit

*[Claude Code](https://claude.com/claude-code) crushes React. This app is fully vibe-coded.*

An opinionated, keyboard-centric markdown editor for presentations and notes with **local AI support** (privacy first). Your data never leaves your machine.

<img src="screenshot.png" alt="Vomit Screenshot" width="600">


## Why Vomit?

| Feature | PowerPoint | Obsidian | Marp | Vomit |
|---------|:----------:|:--------:|:----:|:-----:|
| Markdown native | ❌ | ✅ | ✅ | ✅ |
| Live preview | ✅ | ✅ | ✅ | ✅ |
| Presenter view with notes | ✅ | ❌ | ✅ | ✅ |
| Timer | ✅ | ❌ | ✅ | ✅ |
| Next slide preview | ✅ | ❌ | ✅ | ✅ |
| Standalone app | ✅ | ✅ | ❌ | ✅ |
| PlantUML diagrams | ❌ | Plugin | ✅ | ✅ |
| LaTeX math | ❌ | Plugin | ✅ | ✅ |
| Code syntax highlighting | ❌ | ✅ | ✅ | ✅ |
| **Local AI (privacy first)** | ❌ | Plugin | ❌ | ✅ |
| **RAG over your docs** | ❌ | Plugin | ❌ | ✅ |
| **Pseudonymization** | ❌ | ❌ | ❌ | ✅ |

## Platform Support

**macOS only** (Intel and Apple Silicon)

## Features

- **Markdown Editor** - Live preview, syntax highlighting, outline sidebar
- **Right Outline Bar** - Always-visible document outline on the right (Cmd+Alt+O)
- **Multi-Cursor Editing** - PyCharm-style multi-cursor: double-tap Option, then use Option+Up/Down
- **Drag & Drop** - Drag files and folders to reorganize your file tree
- **Presenter View** - Current slide, next slide preview, speaker notes, timer
- **Local AI (Privacy First)** - Built-in AI terminal powered by Ollama - your data stays on your machine
- **RAG Search** - Index a bucket and ask AI questions with context from that bucket
- **Markdown Todos** - Track `- [ ]` tasks in notes with a bucket-wide Todo Explorer
- **Pseudonymization** - Anonymize sensitive data (names, emails, IPs) with AI, reversible with `/depseudo`
- **LaTeX Math** - Render formulas with KaTeX (`$inline$` and `$$display$$`)
- **PlantUML & Mermaid** - Render sequence diagrams, flowcharts, and more
- **Emoji Shortcodes** - Use `:smile:` syntax like GitHub/Slack
- **File Tree** - Browse and open files in your bucket (Cmd+E)
- **Tag & Todo Explorers** - Browse tags and open todos across the current bucket
- **Search in Files** - Search across all markdown files (Cmd+Shift+F)
- **Laser Pointer** - Press L during presentation to highlight
- **PDF Export** - Export slides to PDF for sharing
- **Image Support** - Paste images directly, resize with simple syntax
- **Themes** - Default, Dark, Catppuccin, Nord, Tokyo Night, Solarized Dark
- **Keyboard Shortcuts** - Full keyboard control for everything

## Buckets

Vomit uses "buckets" - dedicated folders to store your notes and presentations. On first launch, you'll be asked to choose a location (default: `~/Documents/Vomit`).

- **Multiple buckets** - Add as many project folders as you need via the Buckets menu
- **Quick switching** - Switch between buckets with a single click
- New markdown files are automatically created with frontmatter metadata: title, folder, created date, modified date, draft status, and tags
- Images are saved to `bucket/images/`
- No need to manually open folders - just select a bucket and write

Manage buckets from the **Buckets** menu: add new buckets, switch between them, or remove ones you no longer need.

## Todos

Todos are markdown-native. Your notes remain the source of truth; Vomit scans the current bucket and shows matching checkbox items in the Todo Explorer.

```markdown
- [ ] Send migration plan to Acme #follow-up @2026-06-01 !high
- [ ] Check Kubernetes ingress config #tech
- [x] Confirm project owner
```

- Use **Cmd+Shift+Enter** to toggle the current line or selected lines between todo states
- Use **View > Toggle Todos** or the command palette to open the Todo Explorer
- Click a todo in the explorer to open the note at that line
- Optional tokens are parsed as badges: `@YYYY-MM-DD` for due date, `!high`/`!medium`/`!low` for priority, and `#tag` for tags
- Todo Explorer reads saved markdown files in the current bucket; save or wait for auto-save after editing todos

## Installation

### Option 1: Download DMG

Download the latest `.dmg` from [Releases](https://github.com/jacqinthebox/vomit-vnext/releases), open it, and drag to Applications.

**Important:** The app is not code-signed with an Apple Developer certificate. macOS will block it by default. After installing, run this command in Terminal to remove the quarantine flag:

```bash
xattr -cr /Applications/Vomit.app
```

Then the app will open normally.

### Option 2: Build from Source

```bash
# Clone the repository
git clone https://github.com/jacqinthebox/vomit-vnext.git
cd vomit-vnext

# Install dependencies
npm install

# Run the app
npm start

# Or build a DMG
npm run build
```

## Usage

### Slide Format

Separate slides with `---` on its own line:

```markdown
# First Slide

Your content here

---

# Second Slide

More content
```

### Speaker Notes

Add notes after `???` - only visible in presenter view:

```markdown
# Slide Title

Content for the audience

???

Notes only you can see while presenting
```

### Images

Paste images directly with Cmd+V. They are saved to an `images/` folder next to your file.

Resize images with this syntax:

```markdown
![alt text](image.png =400x)      # width 400px
![alt text](image.png =x300)      # height 300px
![alt text](image.png =400x300)   # both
```

### PlantUML Diagrams

Create diagrams using PlantUML syntax in fenced code blocks:

~~~markdown
```plantuml
@startuml
Alice -> Bob: Hello
Bob --> Alice: Hi there!
@enduml
```
~~~

Diagrams are rendered via the PlantUML server. Supports sequence diagrams, class diagrams, flowcharts, and more. See [PlantUML documentation](https://plantuml.com/) for syntax.

### Emoji Shortcodes

Use GitHub/Slack-style emoji shortcodes:

```markdown
:smile: :rocket: :fire: :heart: :thumbsup: :vomit:
```

Renders as: :smile: :rocket: :fire: :heart: :thumbsup: :vomit:

Over 200 shortcodes are supported including smileys, gestures, objects, animals, food, and more.

### Ollama AI Integration (Privacy First)

Vomit includes a built-in AI terminal that talks to **two kinds of local providers**:

- **Ollama** — default, native `/api/chat`.
- **OpenAI-compatible** — any server that exposes `POST /v1/chat/completions`, including:
  - [`mlx_lm.server`](https://github.com/ml-explore/mlx-lm) (Apple Silicon, MLX)
  - vLLM, LM Studio, llama.cpp's `--api-server`, Ollama's own `/v1` shim, etc.

All AI processing happens locally — your data never leaves your machine.

**Setup (Ollama):**
1. Install Ollama from https://ollama.ai
2. Pull a model: `ollama pull qwen2.5:14b` (recommended for best results)
3. Press `Cmd+J` or select a model from the **AI** menu

**Setup (OpenAI-compatible, e.g. MLX):**
1. Start your local server, for example:
   ```bash
   pip install mlx-lm
   mlx_lm.server --model mlx-community/Qwen3-Coder-Next-4bit
   ```
2. In Vomit, open **AI → Add OpenAI-Compatible Endpoint…** and enter:
   - Name: `MLX Qwen3-Coder` (any label you like)
   - Base URL: `http://127.0.0.1:8000/v1`
   - API key: `dummy` (mlx_lm.server ignores it but the field is required)
   - Model id: `mlx-community/Qwen3-Coder-Next-4bit`
3. The provider radio in the AI menu flips to **OpenAI-Compatible** and your new endpoint becomes the active one.
4. Hit **AI → Test AI Connection** to verify the endpoint responds.
5. Press `Cmd+J` and try `/doc summarize this note`.

**Multiple endpoints:** Repeat step 2 to add more (e.g. a remote vLLM box, a second MLX model). Each endpoint shows up as a radio item in the AI menu — click one to switch. Use **Edit "…"** and **Remove "…"** to manage the active endpoint.

> RAG embeddings still use Ollama's `nomic-embed-text` model — only chat/agent
> calls go through the OpenAI-compatible endpoint.

**Command picker:**

Type `/` in the AI terminal to open an inline command picker. Navigate with `↑`/`↓`, press `Enter` to execute (or complete to name + space if the command needs arguments), `Tab` to complete without executing, and `Escape` to close.

**Special commands:**
- `/doc <prompt>` - Include the current document in your prompt
- `/write <prompt>` - Insert AI response at cursor position
- `/write-new <prompt>` - Create a new file with AI response
- `/rewrite <prompt>` - Replace selection with AI response
- `/append <prompt>` - Add AI response at end of document
- `/presentation <topic>` - Generate a presentation with slides and speaker notes
- `/pseudo` - Pseudonymize the current document (names, emails, IPs, secrets)
- `/pseudo all` - Pseudonymize all files in the current folder
- `/depseudo` - Restore original data from pseudonymized file using the mapping
- `/index` - Index the current bucket for RAG search
- `/index <folder>` - Refresh only a specific folder inside the current bucket
- `/reindex` - Clear and rebuild the current bucket's RAG index
- `/rag <query>` - Search the current bucket index and ask AI with context
- `/agent <prompt>` - Agentic mode with tools (bash, file read/write, web search)
- `/new` - Start a new conversation (clear history)
- `/help` - Show all available commands

**Web search with Tavily:**

The `/agent` command supports real-time web search via [Tavily](https://tavily.com). Set your API key once via **AI menu → Set Tavily API Key...**. When you ask the agent to search the web (e.g. `/agent search for the latest news on...`), it will automatically call the Tavily search tool and include current results in its response.

**RAG (Retrieval Augmented Generation):**

RAG allows the AI to answer questions using documents from the current bucket as context. First index the bucket with `/index`, then use `/rag <question>` to query that bucket with relevant context automatically retrieved.

```bash
# First, pull the embedding model
ollama pull nomic-embed-text

# In Vomit AI terminal
/index                              # Index the current bucket
/index customers/acme               # Refresh one folder inside the bucket
/reindex                            # Clear and rebuild the current bucket index
/rag how does authentication work?  # Search the bucket and ask with context
```

The index is stored in `~/.config/vomit/rag/` to keep your bucket clean. Each bucket has its own RAG database. Use `/index <folder>` for a faster partial refresh after changing one folder, or `/reindex` after deleting, moving, or heavily reorganizing notes.

**Command history:**

The AI terminal remembers your last 100 commands across restarts. Use `↑`/`↓` (when no picker is open) to navigate history. `Cmd+K` clears both the conversation and the command history.

The AI menu shows all your installed Ollama models - just click one to switch.

## Keyboard Shortcuts

Press **Cmd+/** to view all shortcuts in the app. See [SHORTCUTS.md](SHORTCUTS.md) for the complete reference.

### Quick Reference

| Category | Shortcut | Action |
|----------|----------|--------|
| **File** | Cmd+N | New file |
| | Cmd+O | Open file |
| | Cmd+S | Save |
| **View** | Cmd+P | Toggle preview |
| | Cmd+E | Toggle file explorer |
| | Cmd+Alt+O | Toggle right outline |
| | Cmd+Shift+H | Toggle tag explorer |
| | Cmd+L | Toggle line numbers |
| | Cmd+/ | Show all shortcuts |
| **Format** | Cmd+B | Bold |
| | Cmd+I | Italic |
| | Cmd+K | Insert link |
| | Cmd+M | Code block |
| | Cmd+Shift+Enter | Toggle todo |
| **Multi-Cursor** | Option, Option, then Option+↑/↓ | Add cursor above/below |
| | Escape | Clear extra cursors |
| **Code** | Ctrl+J | Autocomplete |
| **Explorer** | ↑↓ | Navigate files |
| | ←→ | Navigate folders |
| | Drag & Drop | Move files/folders |
| **Present** | Cmd+Shift+P | Start presentation |
| | Cmd+Alt+P | With presenter view |
| | L | Laser pointer |
| **AI** | Cmd+J | Toggle AI terminal |

## Tech Stack

- Electron
- CodeMirror 5 (editor with syntax highlighting)
- Marked (markdown parsing)
- Highlight.js (code block highlighting)
- KaTeX (LaTeX math rendering)
- PlantUML (diagram rendering)
- Ollama (local AI inference)
- better-sqlite3 (RAG vector storage)

## License

MIT

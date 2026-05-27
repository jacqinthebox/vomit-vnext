# Vomit Keyboard Shortcuts

Press **Cmd+/** to open this help at any time.

---

## File Operations

| Shortcut | Action |
|----------|--------|
| Cmd+T | New tab |
| Cmd+N | New file |
| Cmd+Shift+N | New window |
| Cmd+Alt+N | New presentation |
| Cmd+Alt+Shift+N | New folder |
| Cmd+O | Open file |
| Cmd+W | Close tab |
| Cmd+S | Save |
| Cmd+Shift+S | Save as |
| Cmd+E | Toggle file explorer |

---

## Tabs

| Shortcut | Action |
|----------|--------|
| Cmd+T | New tab |
| Cmd+W | Close tab |
| Cmd+Shift+] | Next tab |
| Cmd+Shift+[ | Previous tab |
| Cmd+2-8 | Go to tab 1-7 |
| Cmd+9 | Go to last tab |

---

## View

| Shortcut | Action |
|----------|--------|
| Cmd+P | Toggle preview pane |
| Cmd+\\ | Toggle focus between editor and preview (split view) |
| Cmd+. | Command palette |
| Cmd+Shift+O | Toggle outline sidebar (left) |
| Cmd+Alt+O | Toggle right outline |
| Cmd+E | Toggle file explorer |
| Cmd+Shift+R | Refresh file tree |
| Cmd+L | Toggle line numbers |
| Alt+Z | Toggle word wrap |
| Cmd+F | Find in file |
| Cmd+Option+F | Find and replace |
| Cmd+Shift+F | Search in files |
| Cmd+Up | Go to parent folder |
| Cmd+` | Toggle shell terminal |
| Cmd+/ | Show keyboard shortcuts |

---

## Text Formatting

| Shortcut | Action |
|----------|--------|
| Cmd+B | Bold |
| Cmd+I | Italic |
| Cmd+` | Inline code |
| Cmd+M | Code block |
| Cmd+K | Insert link |
| Cmd+Shift+T | Insert table |
| Cmd+Shift+1 | Heading 1 |
| Cmd+Shift+2 | Heading 2 |
| Cmd+Shift+3 | Heading 3 |
| Cmd+' | Blockquote |
| Cmd+- | Horizontal rule |
| Cmd+Shift+D | Insert date heading (## YYYY-MM-DD) |
| Cmd+Enter | Insert new slide |

---

## Code Completion

| Shortcut | Action |
|----------|--------|
| Ctrl+J | Trigger autocomplete |
| Ctrl+Space | Trigger autocomplete (alternative) |
| Enter | Accept suggestion |
| Escape | Dismiss suggestions |

---

## Multi-Cursor

| Shortcut | Action |
|----------|--------|
| Option Option ↑ | Add cursor above (double-tap Option, then arrow) |
| Option Option ↓ | Add cursor below (double-tap Option, then arrow) |
| Escape | Clear extra cursors |

---

## File Explorer Navigation

| Shortcut | Action |
|----------|--------|
| ↑ / ↓ | Navigate between files |
| → | Enter folder |
| ← | Go to parent folder |
| Enter | Open file / Enter folder |
| Cmd+1 / Ctrl+Tab | Toggle sidebar focus |
| Ctrl+W | Switch focus to editor |
| Escape | Return focus to editor |
| Drag & Drop | Move files/folders to new location |

---

## Presentation

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+P | Start presentation |
| Cmd+Alt+P | Start with presenter view |

### During Presentation

| Shortcut | Action |
|----------|--------|
| → / Space / N | Next slide |
| ← / P | Previous slide |
| Home | First slide |
| End | Last slide |
| G | Go to slide (enter number) |
| L | Toggle laser pointer |
| R | Reset timer |
| Escape | End presentation |

---

## AI Terminal

| Shortcut | Action |
|----------|--------|
| Cmd+J | Toggle AI terminal |
| Cmd+K | Clear terminal, conversation history, and command history |

### Command Picker

Type `/` to open an inline command picker showing all available commands.

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move selection up/down (wraps around) |
| `Enter` | Execute selected command (or complete to `name ` if args required) |
| `Tab` | Complete input to selected command name + space |
| `Escape` | Close picker, keep input |
| Any character | Re-filter the list |

When the picker is closed, `↑`/`↓` navigate command history (persisted across restarts, up to 100 entries).

### AI Commands

| Command | Action |
|---------|--------|
| `/help` | Show all available commands |
| `/new` | Start a new conversation (clear history) |
| `/doc <prompt>` | Include current document in prompt |
| `/write <prompt>` | Insert AI response at cursor |
| `/write-new <prompt>` | Create new file with AI response |
| `/rewrite <prompt>` | Replace selection with AI response |
| `/append <prompt>` | Add AI response at end of document |
| `/pseudo` | Pseudonymize current document (names, emails, IPs) |
| `/pseudo all` | Pseudonymize all files in current folder |
| `/depseudo` | Restore original data from mapping |
| `/index` | Index current file's folder for RAG (recursive) |
| `/index <subfolder>` | Index a specific subfolder |
| `/rag <query>` | Search indexed docs and ask AI with context |
| `/presentation <topic>` | Generate a presentation on the topic |
| `/agent <prompt>` | Agentic mode with tools (bash, file read/write, web search) |

**Web search:** Set a [Tavily](https://tavily.com) API key via **AI menu → Set Tavily API Key...** to enable real-time web search in `/agent` mode.

---

## Tips

- **Paste images** directly with Cmd+V - they're saved to an `images/` folder
- **Emoji shortcodes** like `:smile:` are automatically converted
- **Speaker notes** go after `???` on a slide
- **Slide separator** is `---` on its own line
- **Frontmatter** supports `theme:`, `font-size:`, `title`, `created`, `modified`, `draft`, and `tags` metadata
- **Privacy first** - All AI runs locally via Ollama, your data never leaves your machine
- **Scroll sync** - In split view, scrolling the editor or preview keeps them aligned

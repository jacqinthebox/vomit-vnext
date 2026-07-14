# Vomit Keyboard Shortcuts

Press **Cmd+/** on macOS or **Ctrl+/** on Windows/Linux to open this help at any time.

Shortcut tables use macOS notation: use **Ctrl** instead of **Cmd** and **Alt** instead of **Option** on Windows/Linux.

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
| Cmd+Alt+W | Close other tabs |
| Cmd+S | Save |
| Cmd+Shift+S | Save as |
| Cmd+Shift+E | Export to PDF |

---

## Tabs

| Shortcut | Action |
|----------|--------|
| Cmd+T | New tab |
| Cmd+W | Close tab |
| Cmd+Alt+W | Close other tabs |
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
| Cmd+Shift+G | Toggle wiki graph |
| Cmd+E | Toggle file explorer |
| Cmd+Shift+R | Refresh file tree |
| Cmd+Shift+H | Toggle tag explorer |
| Cmd+1 | Toggle sidebar focus |
| Cmd+L | Toggle line numbers |
| Alt+Z | Toggle word wrap |
| Cmd+F | Find in file |
| Cmd+Option+F | Find and replace |
| Cmd+Shift+F | Search in files |
| Cmd+Up | Go to parent folder |
| Cmd+` | Toggle shell terminal |
| Cmd+/ | Show keyboard shortcuts |
| Cmd+Shift+/ | Show documentation |

---

## Text Formatting

| Shortcut | Action |
|----------|--------|
| Cmd+B | Bold |
| Cmd+I | Italic |
| Cmd+M | Code block |
| Cmd+K | Insert link |
| Cmd+Shift+T | Format table |
| Cmd+Shift+Enter | Toggle todo line / selected lines |
| Cmd+Shift+1 | Heading 1 |
| Cmd+Shift+2 | Heading 2 |
| Cmd+Shift+3 | Heading 3 |
| Cmd+Shift+8 | Bullet list |
| Cmd+Shift+9 | Numbered list |
| Cmd+' | Blockquote |
| Cmd+- | Horizontal rule |
| Cmd+Shift+D | Insert date heading (## YYYY-MM-DD) |
| Cmd+Enter | Insert new slide |

---

## Todos

Todos are plain markdown checkboxes, so they stay in your notes:

```markdown
- [ ] Open task #follow-up @2026-06-01 !high
- [x] Finished task
```

| Shortcut / Command | Action |
|--------------------|--------|
| Cmd+Shift+Enter | Toggle current line or selected lines as todos |
| View > Toggle Todos | Open the Todo Explorer |
| Command Palette > Toggle Todo Explorer | Open the Todo Explorer |

Todo Explorer scans saved markdown files in the current bucket. It parses `@YYYY-MM-DD` due dates, `!high`/`!medium`/`!low` priorities, and `#tags`.

---

## Tags

Tags are declared in the frontmatter of a document:

```yaml
---
tags: [project, draft, ideas]
---
```

| Shortcut / Command | Action |
|--------------------|--------|
| Cmd+Shift+H | Toggle the Tag Explorer |
| View > Toggle Tags | Open the Tag Explorer |
| Command Palette > Toggle Tag Explorer | Open the Tag Explorer |

The Tag Explorer scans saved markdown files in the current bucket and groups documents by their frontmatter tags.

---

## Code Completion

| Shortcut | Action |
|----------|--------|
| Ctrl+Space | Trigger autocomplete |
| Ctrl+J | Trigger autocomplete (macOS only — on Windows/Linux Ctrl+J toggles the AI terminal) |
| Enter | Accept suggestion |
| Escape | Dismiss suggestions |

---

## Multi-Cursor

Double-tap **Option**, then press **Option+Up** or **Option+Down** to add cursors. Empty lines are skipped when adding cursors.

| Shortcut | Action |
|----------|--------|
| Option, Option, then Option+↑ | Add cursor above |
| Option, Option, then Option+↓ | Add cursor below |
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
| `/write-replace <prompt>` | Replace selection with AI response |
| `/write-append <prompt>` | Research the web and append to the current document |
| `/summarize-folder [subfolder]` | Summarize the current folder and all subfolders into a new doc |
| `/pseudo` `[--ai]` `[--customer "Name"]` | Pseudonymize current document (fast/offline by default; `--ai` for smart scan) |
| `/pseudo-selection` `[--ai]` | Pseudonymize selected editor text, result printed in terminal |
| `/pseudo-repo` `[folder]` `[--all]` `[--ai]` `[--customer "Name"]` | Pseudonymize repos/folders in the bucket (`--all` = every folder, not just git repos) |
| `/pseudo-map` | Show current entity mapping |
| `/pseudo-restore` `[repo-name]` | Restore original data (a pseudo repo if named, else the current document) |
| `--customer "Name"` (flag) | Force a customer/company/person name into the mapping; repeatable, case-insensitive, works offline. Use `--customer "Name=Replacement"` to choose the replacement (e.g. `Lidl=GroceryShop`) |
| `/index` | Index the current bucket for RAG |
| `/index <folder>` | Refresh a specific folder in the bucket index |
| `/reindex` | Clear and rebuild current bucket's RAG index |
| `/rag <query>` | Search current bucket index and ask AI with context |
| `/presentation <topic>` | Generate a presentation on the topic |
| `/agent <prompt>` | Agentic mode with tools (bash, file read/write, web search) |

**Web search:** Set a [Tavily](https://tavily.com) API key via **AI menu → Set Tavily API Key...** to enable real-time web search in `/agent` mode.

---

## Tips

- **Paste images** directly with Cmd+V - they're saved to an `images/` folder
- **Emoji shortcodes** like `:smile:` are automatically converted
- **Speaker notes** go after `???` on a slide
- **Slide separator** is `---` on its own line
- **Frontmatter** supports `theme:`, `font-size:`, `title`, `folder`, `created`, `modified`, `draft`, and `tags` metadata
- **Todos** use markdown checkboxes: `- [ ] open` and `- [x] done`
- **Privacy first** - All AI runs locally via Ollama, your data never leaves your machine
- **Scroll sync** - In split view, scrolling the editor or preview keeps them aligned

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
| Cmd+E | Export to PDF |

---

## Tabs

| Shortcut | Action |
|----------|--------|
| Cmd+T | New tab |
| Cmd+W | Close tab |
| Cmd+Shift+] | Next tab |
| Cmd+Shift+[ | Previous tab |
| Cmd+1-8 | Go to tab 1-8 |
| Cmd+9 | Go to last tab |

---

## View

| Shortcut | Action |
|----------|--------|
| Cmd+P | Toggle preview pane |
| Cmd+O | Toggle outline sidebar |
| Cmd+E | Toggle file explorer |
| Cmd+Shift+R | Refresh file tree |
| Cmd+L | Toggle line numbers |
| Cmd+F | Find in file |
| Cmd+Option+F | Find and replace |
| Cmd+Shift+F | Search in files |
| Cmd+Up | Go to parent folder |
| Cmd+/ | Show keyboard shortcuts |

---

## Text Formatting

| Shortcut | Action |
|----------|--------|
| Cmd+B | Bold |
| Cmd+I | Italic |
| Cmd+` | Inline code |
| Cmd+K | Insert link |
| Cmd+Shift+T | Insert table |
| Cmd+Shift+1 | Heading 1 |
| Cmd+Shift+2 | Heading 2 |
| Cmd+Shift+3 | Heading 3 |
| Cmd+' | Blockquote |
| Cmd+- | Horizontal rule |
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

## File Explorer Navigation

| Shortcut | Action |
|----------|--------|
| ↑ / ↓ | Navigate between files |
| → | Enter folder |
| ← | Go to parent folder |
| Enter | Open file / Enter folder |
| Ctrl+Tab | Switch focus to editor |
| Ctrl+W | Switch focus to editor |
| Escape | Return focus to editor |

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
| Cmd+K | Clear terminal and conversation history |

### AI Commands

| Command | Action |
|---------|--------|
| `/new` | Start a new conversation (clear history) |
| `/doc <prompt>` | Include current document in prompt |
| `/write <prompt>` | Insert AI response at cursor |
| `/write-new <prompt>` | Create new file with AI response |
| `/rewrite <prompt>` | Replace selection with AI response |
| `/append <prompt>` | Add AI response at end of document |
| `/pseudo` | Pseudonymize current document |
| `/depseudo` | Restore original data from mapping |
| `/index` | Index folder for RAG |
| `/index <subfolder>` | Index specific subfolder |
| `/index <file>` | Index a single file |
| `/rag <query>` | Search docs and ask AI |
| `/presentation <topic>` | Generate a presentation on the topic |
| `/agent <prompt>` | Agentic mode with tools (bash, file read/write) |
| `/agent clear` | Clear agent conversation history |

---

## Tips

- **Paste images** directly with Cmd+V - they're saved to an `images/` folder
- **Emoji shortcodes** like `:smile:` are automatically converted
- **Speaker notes** go after `???` on a slide
- **Slide separator** is `---` on its own line
- **Frontmatter** supports `theme:` and `font-size:` settings
- **Privacy first** - All AI runs locally via Ollama, your data never leaves your machine

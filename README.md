# Vomit vNext

Vomit vNext is a fully vibe‑coded macOS app built with Claude Code, initiated by me, even though I’m not a front‑end developer and freely admit I suck at it.
It turns plain Markdown files into polished slide decks, similar to preview plugins in VS Code or Obsidian, but focused entirely on presentation.

 Write your slides in Markdown and present them with a proper presenter view, like a PowerPoint‑style slideshow powered by text files.

## Features

- **Markdown Editor** - Live preview, syntax highlighting, outline sidebar
- **Presenter View** - Current slide, next slide preview, speaker notes, timer
- **LaTeX Math** - Render formulas with KaTeX (`$inline$` and `$$display$$`)
- **File Tree** - Browse and open files in current directory (Cmd+Shift+E)
- **Search in Files** - Search across all markdown files (Cmd+Shift+F)
- **Laser Pointer** - Press L during presentation to highlight
- **PDF Export** - Export slides to PDF for sharing
- **Image Support** - Paste images directly, resize with simple syntax
- **Themes** - Default, Dark, Catppuccin, Nord, Solarized Dark
- **Keyboard Shortcuts** - Full keyboard control for everything

## Installation

### Option 1: Download DMG

Download the latest `.dmg` from [Releases](https://github.com/jacqinthebox/vomit-vnext/releases), open it, and drag to Applications.

**Important:** The app is not code-signed with an Apple Developer certificate. macOS will block it by default. After installing, run this command in Terminal to remove the quarantine flag:

```bash
xattr -cr /Applications/Vomit\ vNext.app
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

## Keyboard Shortcuts

### Editor

| Shortcut | Action |
|----------|--------|
| Cmd+N | New file |
| Cmd+O | Open file |
| Cmd+S | Save |
| Cmd+Shift+S | Save as |
| Cmd+E | Export to PDF |
| Cmd+P | Toggle preview |
| Cmd+Shift+O | Toggle outline |
| Cmd+Shift+E | Toggle file tree |
| Cmd+Shift+F | Search in files |
| Cmd+B | Bold |
| Cmd+I | Italic |
| Cmd+K | Insert link |
| Cmd+1/2/3 | Heading 1/2/3 |
| Cmd+L | Bullet list |
| Cmd+' | Quote |
| Cmd+- | Horizontal rule |
| Cmd+Enter | Insert slide |

### Presentation

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+P | Start presentation |
| Cmd+Alt+P | Start with presenter view |
| Right / Space / N | Next slide |
| Left / P | Previous slide |
| Home | First slide |
| End | Last slide |
| L | Toggle laser pointer |
| R | Reset timer |
| Escape | End presentation |

## Tech Stack

- Electron
- CodeMirror 5 (editor with syntax highlighting)
- Marked (markdown parsing)
- Highlight.js (code block highlighting)
- KaTeX (LaTeX math rendering)

## License

MIT

# Vomit

A markdown presentation app with a presenter view, speaker notes and a laser pointer.

![Vomit Screenshot](screenshot.png) 

*[Claude Code](https://claude.com/claude-code) crushes React. This app is fully vibe-coded.*

## Why Vomit?

| Feature | PowerPoint | Obsidian | Marp | Vomit |
|---------|:----------:|:--------:|:----:|:-----:|
| Markdown native | ❌ | ✅ | ✅ | ✅ |
| Live preview | ✅ | ✅ | ✅ | ✅ |
| Presenter view with notes | ✅ | ❌ | ✅ | ✅ |
| Timer | ✅ | ❌ | ✅ | ✅ |
| Next slide preview | ✅ | ❌ | ✅ | ✅ |
| Standalone app | ✅ | ✅ | ❌ | ✅ |
| PlantUML diagrams | ❌ | Plugin | ✅  | ✅ |
| LaTeX math | ❌ | Plugin | ✅ | ✅ |
| Code syntax highlighting | ❌ | ✅ | ✅ | ✅ |

## Features

- **Markdown Editor** - Live preview, syntax highlighting, outline sidebar
- **Presenter View** - Current slide, next slide preview, speaker notes, timer
- **LaTeX Math** - Render formulas with KaTeX (`$inline$` and `$$display$$`)
- **PlantUML Diagrams** - Render sequence diagrams, flowcharts, and more
- **Emoji Shortcodes** - Use `:smile:` syntax like GitHub/Slack
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

## Keyboard Shortcuts

### Editor

| Shortcut | Action |
|----------|--------|
| Cmd+N | New file |
| Cmd+S | Save |
| Cmd+Shift+S | Save as |
| Cmd+P | Toggle preview |
| Cmd+O | Toggle outline |
| Cmd+E | Toggle file tree |
| Cmd+F | Find in file |
| Cmd+Shift+F | Search in files |
| Cmd+K | Insert link |
| Cmd+Enter | Insert slide |

### Sidebar Navigation

| Shortcut | Action |
|----------|--------|
| Arrow Up/Down | Navigate items |
| Enter | Open file/folder |
| F2 | Rename file/folder |
| Delete | Delete file/folder |
| Escape | Return to editor |

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
- PlantUML (diagram rendering)

## License

MIT

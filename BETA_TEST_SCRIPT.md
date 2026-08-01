# Vomit Beta Test Script

Use this script to test Vomit on macOS and Windows before wider distribution.

## 0. Preparation

Required:

- Latest Vomit release from GitHub Releases
- A test bucket folder:
  - macOS: `~/Documents/Vomit Test`
  - Windows: `Documents\Vomit Test`
- Optional for AI:
  - Ollama installed
  - Chat model installed, for example `ollama pull llama3.2`
  - RAG embedding model installed: `ollama pull nomic-embed-text`

Shortcut notation:

- macOS: use `Cmd` and `Option`
- Windows/Linux: use `Ctrl` instead of `Cmd`, and `Alt` instead of `Option`

## 1. Installation and first launch

### 1.1 Install app

1. Download the latest release.
2. Install/open the app.
3. On Windows SmartScreen, choose **More info** > **Run anyway**.
4. On macOS Gatekeeper, right-click the app, choose **Open**, and confirm.

Expected: Vomit starts without crashing.

### 1.2 Choose first bucket

1. Choose or create a test bucket, for example `Vomit Test`.
2. Confirm the file tree appears.
3. Confirm the window title shows the bucket name.

Expected: Bucket opens and the file tree is visible.

## 2. Basic markdown editing

### 2.1 Create file

1. Choose **File > New File** or press `Cmd/Ctrl+N`.
2. Create `test-note.md`.
3. Add:

```markdown
# Test Note

Dit is een testdocument.

## Taken

- [ ] Eerste taak
- [x] Tweede taak

## Lijst

- Appels
- Peren
- Bananen
```

4. Save with `Cmd/Ctrl+S`.

Expected: File is saved and appears in the file tree.

### 2.2 Reopen

1. Close the tab.
2. Reopen `test-note.md` from the file tree.

Expected: Content is intact.

## 3. Preview and markdown rendering

### 3.1 Toggle preview

1. Press `Cmd/Ctrl+P`.
2. Check live preview.

Expected: Headings, lists, and todos render correctly.

### 3.2 Toggle editor/preview focus

1. Enable preview.
2. Press `Cmd/Ctrl+\`.

Expected: Focus switches between editor and preview.

### 3.3 Horizontal image scroll regression

1. Add:

```markdown
![Heel lange afbeeldingstitel met veel tekst die normaal horizontaal scrollen zou kunnen veroorzaken](images/test-image.png)
```

2. Optionally paste a real image.
3. Try to scroll horizontally in the editor.

Expected: Editor remains readable; no annoying horizontal scroll.

## 4. Images

### 4.1 Paste image

1. Copy an image to the clipboard.
2. Paste in the editor with `Cmd/Ctrl+V`.
3. Check inserted markdown.
4. Check preview.

Expected: Image is saved in `images/` and visible in preview.

### 4.2 Resize image

Use:

```markdown
![Mijn afbeelding](images/example.png =300x)
```

or:

```markdown
![Mijn afbeelding](images/example.png =300x200)
```

Expected: Image renders at the requested size.

## 5. File tree

### 5.1 Create folder

1. Create folder `notes`.
2. Create `notes/daily.md`.
3. Open the file.

Expected: Folder and file appear correctly.

### 5.2 Drag and drop

1. Drag `daily.md` to another folder.
2. Reopen the file.

Expected: File moved and remains readable.

### 5.3 Rename and delete

1. Rename a file.
2. Delete a test file.
3. Confirm the file tree refreshes.

Expected: Changes are reflected correctly.

## 6. Tabs

### 6.1 Multiple tabs

1. Open three markdown files.
2. Switch tabs with `Cmd/Ctrl+Shift+]` and `Cmd/Ctrl+Shift+[`.
3. Use `Cmd/Ctrl+1`, `Cmd/Ctrl+2`, etc.

Expected: Tabs switch correctly.

### 6.2 Unsaved changes

1. Modify a file.
2. Close the tab without saving.
3. Check the dialog.

Expected: App asks to save, do not save, or cancel.

## 7. Formatting shortcuts

Test each action on selected text.

| Action       | macOS             | Windows/Linux      |
| ------------ | ----------------- | ------------------ |
| Bold         | `Cmd+B`           | `Ctrl+B`           |
| Italic       | `Cmd+I`           | `Ctrl+I`           |
| Link         | `Cmd+K`           | `Ctrl+K`           |
| Code block   | `Cmd+M`           | `Ctrl+M`           |
| Format table | `Cmd+Shift+T`     | `Ctrl+Shift+T`     |
| Toggle todo  | `Cmd+Shift+Enter` | `Ctrl+Shift+Enter` |
| New slide    | `Cmd+Enter`       | `Ctrl+Enter`       |

Expected: Markdown is inserted or updated correctly.

## 8. Todos

### 8.1 Todo Explorer

1. Add:

```markdown
- [ ] Bel klant #follow-up @2026-06-10 !high
- [ ] Check Windows build #release !medium
- [x] Oude taak #done
```

2. Open Todo Explorer via menu or command palette.
3. Check labels, due dates, and priorities.

Expected: Todos appear grouped/readable.

### 8.2 Toggle todo

1. Put cursor on a todo.
2. Use the todo shortcut.

Expected: `[ ]` toggles to `[x]` and back.

## 9. Tags

Create:

```markdown
---
title: Project Alpha
tags: [project, alpha, test]
---

# Project Alpha
```

1. Open Tag Explorer.
2. Check tags.

Expected: Tags appear and clicking opens the file.

## 10. Search

### 10.1 Find in file

1. Open `test-note.md`.
2. Press `Cmd/Ctrl+F`.
3. Search for `testdocument`.

Expected: Match is found.

### 10.2 Search in files

1. Press `Cmd/Ctrl+Shift+F`.
2. Search for `Project`.

Expected: Results from multiple files appear.

## 11. Outline

### 11.1 Left outline

Create:

```markdown
# Titel

## Sectie 1

### Details

## Sectie 2
```

Toggle outline.

Expected: Outline shows heading structure.

### 11.2 Right outline

Press `Cmd/Ctrl+Alt+O`.

Expected: Right outline appears/disappears.

## 12. Presentation

### 12.1 Create slides

Create `presentation.md`:

````markdown
# Eerste slide

Welkom bij de test.

???

Speaker note voor slide 1.

---

# Tweede slide

- Punt 1
- Punt 2

???

Speaker note voor slide 2.

---

# Code slide

```js
console.log('hello Vomit');
```

---

# Laatste slide

Einde.
````

### 12.2 Start presentation

1. Press `Cmd/Ctrl+Shift+P`.
2. Navigate:
   - Right / Space / N: next slide
   - Left / P: previous slide
   - Home: first slide
   - End: last slide
   - Escape: stop

Expected: Slides render correctly.

### 12.3 Presenter view

1. Press `Cmd/Ctrl+Alt+P`.
2. Check speaker notes.
3. Check timer.
4. Check next slide preview.

Expected: Presenter view works and notes are visible.

### 12.4 Laser pointer

Press `L` during presentation.

Expected: Laser pointer toggles.

## 13. PDF export

1. Open presentation.
2. Choose **Export to PDF**.
3. Save as `presentation-test.pdf`.
4. Open PDF outside Vomit.

Expected: PDF is generated correctly.

## 14. Native PDF viewer

1. Open an existing PDF in Vomit.
2. Or open `presentation-test.pdf`.

Expected: PDF opens in the native viewer, not as text.

## 15. draw.io viewer

### 15.1 Open draw.io file

1. Create or download a `.drawio` file.
2. Open it in Vomit.

Expected: Diagram opens in the viewer.

### 15.2 With draw.io CLI installed

1. Open a complex `.drawio` file.
2. Check labels, arrows, and colors.

Expected: SVG rendering looks correct.

### 15.3 Without draw.io CLI

1. Test on a machine without draw.io CLI.
2. Open `.drawio`.

Expected: App does not crash; fallback or clear error appears.

## 16. AI terminal

### 16.1 Open AI terminal

1. Start Ollama.
2. Press `Cmd/Ctrl+J`.

Expected: AI terminal opens.

### 16.2 Model detection

1. Open AI menu.
2. Check whether Ollama models are visible.

Expected: Installed models appear.

### 16.3 Basic prompt

Type:

```text
Leg in 3 bullets uit wat markdown is.
```

Expected: AI answers in the terminal.

### 16.4 `/doc`

Open a markdown file and type:

```text
/doc vat dit document samen
```

Expected: AI uses current document content.

### 16.5 `/write`

Type:

```text
/write schrijf een korte alinea over lokale AI
```

Expected: Response is inserted into the editor.

### 16.6 `/rewrite`

1. Select a paragraph.
2. Type:

```text
/rewrite maak dit bondiger
```

Expected: Selected text is replaced.

### 16.7 `/append`

Type:

```text
/append voeg drie actiepunten toe
```

Expected: Text is appended to the document.

### 16.8 Stop response

1. Start a long prompt.
2. Press `Ctrl+C` or the stop button.

Expected: Generation stops cleanly.

### 16.9 Clear terminal

Press `Cmd/Ctrl+K`.

Expected: Terminal/conversation history is cleared.

## 17. Shell terminal

1. Open shell terminal with `Cmd/Ctrl+\``.
2. Run:
   - macOS/Linux:
     ```bash
     pwd
     ls
     ```
   - Windows:
     ```powershell
     pwd
     dir
     ```

Expected: Shell works in the project/bucket context.

## 18. RAG

### 18.1 Prepare

Run:

```bash
ollama pull nomic-embed-text
```

### 18.2 Create index

1. Create multiple documents about different topics.
2. Open AI terminal.
3. Type:

```text
/index
```

Expected: Index process starts and shows progress.

### 18.3 RAG query

Type:

```text
/rag welke projecten staan in mijn notities?
```

Expected: Relevant chunks/documents are used in the answer.

### 18.4 Subfolder index

Type:

```text
/index notes
```

Expected: Only the subfolder is refreshed.

## 19. Pseudonymization

### 19.1 Sensitive document

Create `sensitive.md`:

```markdown
# Klantnotitie

Jan de Vries werkt bij Acme BV.
Zijn email is jan.devries@example.com.
Server IP: 192.168.1.20.
Afspraak met Maria Jansen op vrijdag.
```

### 19.2 `/pseudo`

1. Open file.
2. Type in AI terminal:

```text
/pseudo
```

Expected:

- new pseudo file is created
- mapping JSON is saved
- names/email/IP are replaced

### 19.3 `/depseudo`

1. Open pseudo file.
2. Type:

```text
/depseudo
```

Expected: Original values are restored in the original file.

### 19.4 `/pseudo all`

1. Create multiple files with names/emails.
2. Type:

```text
/pseudo all
```

Expected: Batch works without crash and mappings remain usable.

## 20. Command palette

1. Press `Cmd/Ctrl+.`.
2. Search for:
   - Preview
   - Toggle Tags
   - Toggle Todos
   - Presentation
   - Line Numbers

Expected: Commands are findable and executable.

## 21. Keyboard shortcuts help

1. Press `Cmd/Ctrl+/`.
2. Check labels.

Expected:

- macOS shows Cmd/Option
- Windows/Linux shows Ctrl/Alt

## 22. Buckets

### 22.1 Add bucket

1. Create second test folder `Vomit Test 2`.
2. Add bucket via Buckets menu.
3. Switch between buckets.

Expected: File tree switches correctly.

### 22.2 Remove bucket

1. Remove bucket from list.
2. Confirm files on disk are not deleted.

Expected: Only bucket config changes.

## 23. External changes

1. Open a file in Vomit.
2. Modify the same file outside Vomit.
3. Return to Vomit.

Expected: App detects external change or reloads cleanly without data loss.

## 24. Autosave

1. Enable autosave.
2. Modify document.
3. Wait a few seconds.
4. Close and reopen app.

Expected: Change is saved.

## 25. Update/restart behavior

1. Quit app fully.
2. Start again.
3. Check:
   - last bucket opens
   - recent tabs/files work if supported
   - no update popup if current version is latest

Expected: App starts cleanly.

## 26. Windows-specific

### 26.1 Installer

1. Download `Vomit.Setup.1.14.0.exe`.
2. Install.
3. Start from Start Menu.

Expected: App starts.

### 26.2 Portable

1. Download `Vomit.1.14.0.exe`.
2. Start directly.

Expected: App starts without installation.

### 26.3 File association / Open with

1. Right-click `.md`.
2. Choose **Open with > Vomit**.
3. Repeat with `.pdf` and `.drawio`.

Expected: File opens in Vomit.

### 26.4 Windows shortcuts

| Action         | Shortcut       |
| -------------- | -------------- |
| AI terminal    | `Ctrl+J`       |
| Preview        | `Ctrl+P`       |
| Save           | `Ctrl+S`       |
| Search         | `Ctrl+Shift+F` |
| Presentation   | `Ctrl+Shift+P` |
| Presenter view | `Ctrl+Alt+P`   |
| Shortcuts      | `Ctrl+/`       |

## 27. macOS-specific

### 27.1 DMG

1. Download `.dmg`.
2. Drag app to Applications.
3. Open app.

Expected: App opens.

### 27.2 Open with

1. Right-click `.md`.
2. Open with Vomit.

Expected: File opens.

### 27.3 macOS shortcuts

| Action         | Shortcut      |
| -------------- | ------------- |
| AI terminal    | `Cmd+J`       |
| Preview        | `Cmd+P`       |
| Save           | `Cmd+S`       |
| Search         | `Cmd+Shift+F` |
| Presentation   | `Cmd+Shift+P` |
| Presenter view | `Cmd+Alt+P`   |
| Shortcuts      | `Cmd+/`       |

## 28. Crash/data-loss checks

Test deliberately:

1. Open large markdown file.
2. Paste large image.
3. Open PDF.
4. Open draw.io.
5. Start AI prompt.
6. Quit app during/after editing.
7. Reopen app.

Expected: No corrupt files, no crash loop, no lost saved documents.

## 29. Performance smoke test

1. Create bucket with at least 50 markdown files.
2. Open file tree.
3. Search in files.
4. Toggle preview.
5. Index with RAG.

Expected: App remains responsive enough.

## 30. Tester issue template

```text
Platform:
Windows/macOS version:
Vomit version:
Installer or portable:
Ollama installed: yes/no
Model:
Step where it failed:
What happened:
What did you expect:
Screenshot/log:
Can you reproduce it:
```

## Acceptance criteria for wider distribution

Vomit is ready for broader distribution when:

1. Installation works on at least 3 Windows machines.
2. Installation works on at least 2 macOS machines.
3. No data-loss bugs in save/autosave.
4. Markdown editing/preview is stable.
5. PDF and draw.io open without crashes.
6. AI terminal fails gracefully when Ollama is missing.
7. Pseudonymization creates mappings and can reverse them.
8. Presentation mode works with speaker notes.
9. Windows shortcuts show and work as Ctrl/Alt.
10. Release artifacts are downloadable from GitHub Releases.

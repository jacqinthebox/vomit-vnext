// FormattingManager — Text formatting operations for the editor.
// Depends only on CodemirrorHost. Preview updates happen via CM change event.

class FormattingManager {
  constructor({ host }) {
    this.host = host;
  }

  wrapSelection(before, after) {
    const cm = this.host.cm;
    const selection = cm.getSelection();
    cm.replaceSelection(before + selection + after);

    if (!selection) {
      const cursor = cm.getCursor();
      cm.setCursor({ line: cursor.line, ch: cursor.ch - after.length });
    }
    cm.focus();
  }

  wrapCodeBlock() {
    const cm = this.host.cm;
    const selection = cm.getSelection();

    if (selection) {
      const trimmed = selection.replace(/^\n+/, '').replace(/\n+$/, '');
      cm.replaceSelection('```\n' + trimmed + '\n```');
    } else {
      const cursor = cm.getCursor();
      cm.replaceSelection('```\n\n```');
      cm.setCursor({ line: cursor.line + 1, ch: 0 });
    }
    cm.focus();
  }

  insertAtLineStart(prefix) {
    const cm = this.host.cm;
    const cursor = cm.getCursor();
    const line = cursor.line;

    cm.replaceRange(prefix, { line: line, ch: 0 }, { line: line, ch: 0 });
    cm.setCursor({ line: line, ch: prefix.length + cursor.ch });
    cm.focus();
  }

  insertText(text) {
    const cm = this.host.cm;
    cm.replaceSelection(text);
    cm.focus();
  }

  insertLink() {
    const cm = this.host.cm;
    const selection = cm.getSelection();
    const linkText = selection || 'link text';
    const link = `[${linkText}](url)`;

    cm.replaceSelection(link);

    // Select 'url' part
    const cursor = cm.getCursor();
    const urlStart = cursor.ch - 4;
    cm.setSelection(
      { line: cursor.line, ch: urlStart },
      { line: cursor.line, ch: urlStart + 3 }
    );
    cm.focus();
  }

  toggleLineWrapping() {
    const cm = this.host.cm;
    const currentWrap = cm.getOption('lineWrapping');
    cm.setOption('lineWrapping', !currentWrap);
  }

  toggleTodoLine() {
    const cm = this.host.cm;
    const selections = cm.listSelections();
    const lines = new Set();

    for (const selection of selections) {
      const start = Math.min(selection.anchor.line, selection.head.line);
      let end = Math.max(selection.anchor.line, selection.head.line);
      const endCursor = selection.anchor.line > selection.head.line ? selection.anchor : selection.head;
      if (end > start && endCursor.ch === 0) end--;
      for (let line = start; line <= end; line++) {
        lines.add(line);
      }
    }

    const targetLines = [...lines].sort((a, b) => a - b);
    const checkboxStates = targetLines
      .filter(line => !this._isLineInFence(line))
      .map(line => this._parseTodoLine(cm.getLine(line)))
      .filter(parsed => parsed.type === 'checkbox')
      .map(parsed => parsed.checked);
    const shouldCheck = checkboxStates.length > 0 && checkboxStates.some(checked => !checked);

    cm.operation(() => {
      for (const line of targetLines) {
        if (this._isLineInFence(line)) continue;

        const text = cm.getLine(line);
        const parsed = this._parseTodoLine(text);
        let replacement = null;

        if (parsed.type === 'checkbox') {
          const mark = shouldCheck ? 'x' : ' ';
          replacement = `${parsed.indent}${parsed.marker} [${mark}] ${parsed.text}`;
        } else if (parsed.type === 'bullet') {
          replacement = `${parsed.indent}${parsed.marker} [ ] ${parsed.text}`;
        } else if (parsed.type === 'numbered') {
          replacement = `${parsed.indent}- [ ] ${parsed.text}`;
        } else if (parsed.type === 'plain') {
          replacement = `${parsed.indent}- [ ] ${parsed.text}`;
        } else if (parsed.type === 'empty') {
          replacement = `${parsed.indent}- [ ] `;
        }

        if (replacement !== null) {
          cm.replaceRange(replacement, { line, ch: 0 }, { line, ch: text.length });
        }
      }
    });

    if (targetLines.length === 1 && cm.getLine(targetLines[0]).endsWith('- [ ] ')) {
      cm.setCursor({ line: targetLines[0], ch: cm.getLine(targetLines[0]).length });
    }
    cm.focus();
  }

  _parseTodoLine(line) {
    const checkbox = line.match(/^(\s*)([-*+])\s+\[([ xX])\]\s?(.*)$/);
    if (checkbox) {
      return {
        type: 'checkbox',
        indent: checkbox[1],
        marker: checkbox[2],
        checked: checkbox[3].toLowerCase() === 'x',
        text: checkbox[4]
      };
    }

    const bullet = line.match(/^(\s*)([-*+])\s+(.*)$/);
    if (bullet) {
      return { type: 'bullet', indent: bullet[1], marker: bullet[2], text: bullet[3] };
    }

    const numbered = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (numbered) {
      return { type: 'numbered', indent: numbered[1], text: numbered[2] };
    }

    const plain = line.match(/^(\s*)(.*)$/);
    if (plain && plain[2].length > 0) {
      return { type: 'plain', indent: plain[1], text: plain[2] };
    }

    return { type: 'empty', indent: line.match(/^\s*/)[0] };
  }

  _isLineInFence(lineNumber) {
    let inFence = false;
    for (let line = 0; line < lineNumber; line++) {
      if (/^\s*(```|~~~)/.test(this.host.cm.getLine(line) || '')) {
        inFence = !inFence;
      }
    }
    return inFence;
  }

  formatTable() {
    const cm = this.host.cm;
    const cursor = cm.getCursor();
    const lineCount = cm.lineCount();

    // Find table boundaries (lines starting with |)
    let startLine = cursor.line;
    let endLine = cursor.line;

    while (startLine > 0 && cm.getLine(startLine - 1).trim().startsWith('|')) {
      startLine--;
    }

    if (!cm.getLine(startLine).trim().startsWith('|')) {
      return; // Not in a table
    }

    while (endLine < lineCount - 1 && cm.getLine(endLine + 1).trim().startsWith('|')) {
      endLine++;
    }

    const tableLines = [];
    for (let i = startLine; i <= endLine; i++) {
      tableLines.push(cm.getLine(i));
    }

    const rows = tableLines.map(line => {
      const cells = line.split('|').map(cell => cell.trim());
      if (cells[0] === '') cells.shift();
      if (cells[cells.length - 1] === '') cells.pop();
      return cells;
    });

    if (rows.length < 2) return;

    const colCount = Math.max(...rows.map(r => r.length));
    const colWidths = [];

    for (let col = 0; col < colCount; col++) {
      let maxWidth = 3;
      for (let row = 0; row < rows.length; row++) {
        const cell = rows[row][col] || '';
        if (row === 1 && cell.match(/^[-:]+$/)) continue;
        maxWidth = Math.max(maxWidth, cell.length);
      }
      colWidths.push(maxWidth);
    }

    const formattedLines = rows.map((row, rowIndex) => {
      const cells = [];
      for (let col = 0; col < colCount; col++) {
        let cell = row[col] || '';

        if (rowIndex === 1 && (cell.match(/^[-:]+$/) || cell === '')) {
          const leftAlign = cell.startsWith(':');
          const rightAlign = cell.endsWith(':');
          const dashes = '-'.repeat(colWidths[col]);
          if (leftAlign && rightAlign) {
            cell = ':' + '-'.repeat(colWidths[col] - 2) + ':';
          } else if (leftAlign) {
            cell = ':' + '-'.repeat(colWidths[col] - 1);
          } else if (rightAlign) {
            cell = '-'.repeat(colWidths[col] - 1) + ':';
          } else {
            cell = dashes;
          }
        } else {
          cell = cell.padEnd(colWidths[col]);
        }
        cells.push(cell);
      }
      return '| ' + cells.join(' | ') + ' |';
    });

    const from = { line: startLine, ch: 0 };
    const to = { line: endLine, ch: cm.getLine(endLine).length };
    cm.replaceRange(formattedLines.join('\n'), from, to);
    cm.focus();
  }

  insertSlide() {
    const cm = this.host.cm;
    const content = cm.getValue();
    const cursor = cm.getCursor();

    if (cursor.line === 0 && cursor.ch === 0 && content.startsWith('---')) {
      const endIndex = content.indexOf('---', 3);
      if (endIndex !== -1) {
        const frontmatterEnd = content.substring(0, endIndex + 3);
        const lines = frontmatterEnd.split('\n').length - 1;
        cm.setCursor({ line: lines, ch: 0 });
      }
    }

    const slideTemplate = '\n\n---\n\n# New Slide\n\nContent here\n\n???\nSpeaker notes here\n';
    cm.replaceSelection(slideTemplate);
    cm.focus();
  }

  insertTable() {
    const cm = this.host.cm;
    const tableTemplate = `
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
`;
    cm.replaceSelection(tableTemplate);
    cm.focus();
  }

  insertDateHeading() {
    const cm = this.host.cm;
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateStr = `## ${year}-${month}-${day}\n\n`;

    cm.replaceSelection(dateStr);
    cm.focus();
  }
}

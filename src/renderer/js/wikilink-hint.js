// Wikilink autocomplete — fires when the user types `[[` inside the editor.
// Fetches the bucket's note list once per minute and filters by what the user
// has typed since the opening `[[`. Inserts `[[note]]` and places the cursor
// after the closing brackets.
(function() {
  const CodeMirror = window.CodeMirror;
  if (!CodeMirror) return;

  let cachedNotes = null;
  let cachedAt = 0;
  let cachedBucket = null;
  let indexInFlight = false;
  const CACHE_TTL_MS = 60_000;

  async function loadNotes(bucketRoot, force = false) {
    if (!bucketRoot) return [];
    const now = Date.now();
    if (
      !force &&
      cachedBucket === bucketRoot &&
      cachedNotes &&
      now - cachedAt < CACHE_TTL_MS
    ) {
      return cachedNotes;
    }
    try {
      const result = await window.vomit.wikiListNotes(bucketRoot);
      if (result && result.success) {
        cachedNotes = result.notes || [];
        cachedAt = now;
        cachedBucket = bucketRoot;

        // If the index is empty (never built or stale-empty), kick a
        // background reindex so the next [[ has suggestions. Capped to one
        // in-flight request to avoid thrashing.
        if (cachedNotes.length === 0 && !indexInFlight && window.vomit.wikiIndex) {
          indexInFlight = true;
          window.vomit.wikiIndex(bucketRoot)
            .then((res) => {
              indexInFlight = false;
              if (res && res.success) cachedAt = 0; // force-reload next call
            })
            .catch(() => { indexInFlight = false; });
        }

        return cachedNotes;
      }
    } catch {}
    return cachedNotes || [];
  }

  // Invalidate the cache when the index changes so newly-added notes appear
  // in suggestions without a 1-minute wait.
  window.addEventListener('vomit:wiki-changed', () => {
    cachedAt = 0;
  });

  // Returns { from, to, query } describing the `[[query` span at the cursor,
  // or null if the cursor isn't inside an unclosed wikilink.
  function detectOpenWikilink(cm) {
    const cur = cm.getCursor();
    const line = cm.getLine(cur.line);
    if (!line) return null;
    const before = line.substring(0, cur.ch);
    const open = before.lastIndexOf('[[');
    if (open === -1) return null;
    // A `]]` between open and cursor means the link is already closed.
    if (before.indexOf(']]', open) !== -1) return null;
    const query = before.substring(open + 2);
    // Bail if the query contains a newline-ish char or a bracket — not a clean
    // wikilink in progress.
    if (/[\[\]\n]/.test(query)) return null;
    return {
      from: { line: cur.line, ch: open + 2 },
      to: cur,
      query
    };
  }

  function rankNotes(notes, query) {
    if (!query) {
      return notes.slice(0, 20).map(n => ({
        text: n.basename,
        displayText: n.basename,
        note: n
      }));
    }
    const q = query.toLowerCase();
    const scored = [];
    for (const n of notes) {
      const base = n.basename.toLowerCase();
      let score = -1;
      if (base === q) score = 100;
      else if (base.startsWith(q)) score = 80;
      else if (base.includes(q)) score = 50;
      else if (n.title && n.title.toLowerCase().includes(q)) score = 30;
      if (score >= 0) {
        scored.push({ score, note: n });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.note.basename.localeCompare(b.note.basename));
    return scored.slice(0, 20).map(s => ({
      text: s.note.basename,
      displayText: s.note.title ? `${s.note.basename} — ${s.note.title}` : s.note.basename,
      note: s.note
    }));
  }

  async function wikilinkHint(cm, getBucketRoot) {
    const span = detectOpenWikilink(cm);
    if (!span) return null;

    const bucketRoot = getBucketRoot();
    const notes = await loadNotes(bucketRoot);
    if (!notes || notes.length === 0) return null;

    const matches = rankNotes(notes, span.query);
    if (matches.length === 0) return null;

    // CM's show-hint addon will replace from→to with the picked item's text.
    // After replacement we want `]]` after the cursor — handle in `hint` cb.
    const completion = {
      from: span.from,
      to: span.to,
      list: matches.map(m => ({
        text: m.text,
        displayText: m.displayText,
        hint(cm2, _data, item) {
          const lineAfter = cm2.getLine(span.to.line).substring(span.to.ch);
          const closing = lineAfter.startsWith(']]') ? '' : ']]';
          cm2.replaceRange(item.text + closing, span.from, span.to);
          // Place cursor after the closing brackets.
          const finalCh = span.from.ch + item.text.length + closing.length;
          cm2.setCursor({ line: span.from.line, ch: finalCh });
        }
      }))
    };
    return completion;
  }

  /**
   * Wire wikilink autocomplete to a CodeMirror instance.
   * @param {*} cm
   * @param {() => string|null} getBucketRoot — fn returning current bucket root
   */
  function attachWikilinkHint(cm, getBucketRoot) {
    // Pre-warm the cache so the first `[[` is snappy.
    loadNotes(getBucketRoot());

    cm.on('inputRead', (instance, change) => {
      // Trigger on the second `[` of `[[` or any subsequent typed char.
      if (!change || !change.text) return;
      const lastChar = change.text[change.text.length - 1] || '';
      if (lastChar.length !== 1) return;
      const span = detectOpenWikilink(instance);
      if (!span) return;

      // Only auto-open when we just typed `[[` (query is empty) or are typing
      // into an open link. Don't fight other hints (e.g. yaml frontmatter).
      const isOpening = span.query === '' && lastChar === '[';
      const isContinuing = span.query.length > 0 && /\S/.test(lastChar);
      if (!isOpening && !isContinuing) return;

      instance.showHint({
        hint: (cm2) => wikilinkHint(cm2, getBucketRoot),
        completeSingle: false,
        closeOnUnfocus: true
      });
    });
  }

  window.VomitWikilinkHint = {
    attachWikilinkHint,
    invalidateCache() { cachedAt = 0; }
  };
})();

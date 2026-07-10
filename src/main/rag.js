// @ts-check
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const Database = require('better-sqlite3');
const { extractPdfText } = require('./services/pdfText');

// Split text into chunks with overlap
function chunkText(text, chunkSize = 500, overlap = 50) {
  const words = text.split(/\s+/);
  const chunks = [];

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim()) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

// Cosine similarity between two vectors
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Resolve which embedding backend to use. Ollama with nomic-embed-text wins
// when present (existing setups keep working unchanged); otherwise fall back
// to the active OpenAI-compatible endpoint (e.g. LM Studio), which serves
// embedding models via /v1/embeddings. Returns null when neither is usable.
function resolveEmbedBackend(state, configStore) {
  const tools = state && state.availableAITools;
  if (tools && tools.ollama && tools.ollamaModels.some(m => m.includes('nomic-embed-text'))) {
    return { kind: 'ollama' };
  }
  if (configStore && configStore.getAIProvider() === 'openai-compatible') {
    const ep = configStore.getActiveOpenAIEndpoint();
    if (ep && ep.baseUrl) {
      return {
        kind: 'openai',
        baseUrl: ep.baseUrl,
        apiKey: ep.apiKey || '',
        model: configStore.getOpenAIEmbedModel()
      };
    }
  }
  return null;
}

const NO_EMBED_BACKEND_ERROR =
  'No embedding backend available. Either install Ollama and run: ollama pull nomic-embed-text — ' +
  'or select an OpenAI-compatible provider (e.g. LM Studio) with an embedding model downloaded ' +
  '(model name via AI menu → Set Embeddings Model…).';

// Get embedding from the resolved backend: Ollama's native API, or an
// OpenAI-compatible /embeddings endpoint. No backend argument means Ollama
// (the historical default).
async function getEmbedding(text, backend) {
  try {
    if (!backend || backend.kind === 'ollama') {
      const response = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) return null;
      const json = await response.json();
      return json.embedding || null;
    }

    const url = backend.baseUrl.replace(/\/+$/, '') + '/embeddings';
    const headers = { 'Content-Type': 'application/json' };
    if (backend.apiKey) headers['Authorization'] = `Bearer ${backend.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: backend.model, input: text }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) return null;
    const json = await response.json();
    return (json.data && json.data[0] && json.data[0].embedding) || null;
  } catch (e) {
    return null;
  }
}

function getRAGDatabasePath(folderPath) {
  const configDir = path.join(os.homedir(), '.config', 'vomit', 'rag');
  const pathHash = crypto.createHash('md5').update(folderPath).digest('hex').substring(0, 12);
  const folderName = path.basename(folderPath);
  return path.join(configDir, `${folderName}-${pathHash}.db`);
}

// Get or create SQLite database for a bucket
function getRAGDatabase(folderPath) {
  // Store in ~/.config/vomit/rag/ using hash of project path
  const configDir = path.join(os.homedir(), '.config', 'vomit', 'rag');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const dbPath = getRAGDatabasePath(folderPath);

  const db = new Database(dbPath);

  // Create tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_file_path ON chunks(file_path);
  `);

  return db;
}

function clearRAGDatabase(folderPath) {
  const dbPath = getRAGDatabasePath(folderPath);
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  let deleted = 0;

  for (const filePath of files) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      deleted++;
    }
  }

  return { deleted, dbPath };
}

// Index all documents in a bucket, or refresh one folder/file within the bucket.
async function indexFolder(projectRoot, targetPath, progressCallback, backend) {
  const extensions = ['.md', '.txt', '.js', '.ts', '.py', '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.tf', '.sh', '.tpl', '.pdf'];
  // Always store database at bucket scope
  const db = getRAGDatabase(projectRoot);

  // Check if targetPath is a single file or a directory
  let targetStat;
  try {
    targetStat = fs.statSync(targetPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Path not found: "${targetPath}"\nUse /index without arguments to index the current bucket.`);
    }
    throw err;
  }
  const isSingleFile = targetStat.isFile();

  if (isSingleFile) {
    // For single file, only clear chunks for that file
    const relativePath = path.relative(projectRoot, targetPath);
    db.prepare('DELETE FROM chunks WHERE file_path = ?').run(relativePath);
  } else {
    // If refreshing a folder, only clear chunks from that folder. Match on
    // the prefix up to and including the separator (via substr, not LIKE, to
    // avoid wildcard semantics) so refreshing "notes" leaves a sibling
    // "notes-archive" untouched.
    const isFolderRefresh = targetPath !== projectRoot;
    if (isFolderRefresh) {
      const folderPrefix = path.relative(projectRoot, targetPath) + path.sep;
      db.prepare('DELETE FROM chunks WHERE substr(file_path, 1, ?) = ?')
        .run(folderPrefix.length, folderPrefix);
    } else {
      // Clear entire index when indexing full project
      db.exec('DELETE FROM chunks');
    }
  }

  // Get files to index
  let files = [];

  if (isSingleFile) {
    // Single file - just use it directly
    files = [targetPath];
  } else {
    // Recursively find all files in directory
    const findFiles = (dir) => {
      const found = [];
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          if (item.startsWith('.') || item === 'node_modules' || item === 'pseudonymized') continue;
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            found.push(...findFiles(fullPath));
          } else {
            const ext = path.extname(item).toLowerCase();
            if (extensions.includes(ext)) {
              found.push(fullPath);
            }
          }
        }
      } catch (e) {}
      return found;
    };
    files = findFiles(targetPath);
  }
  let processed = 0;
  let chunksIndexed = 0;

  const insertStmt = db.prepare(
    'INSERT INTO chunks (file_path, chunk_index, content, embedding) VALUES (?, ?, ?, ?)'
  );

  for (const file of files) {
    try {
      // PDFs go through pdf.js text extraction; everything else is read as
      // plain text.
      const isPdf = path.extname(file).toLowerCase() === '.pdf';
      const content = isPdf ? await extractPdfText(file) : fs.readFileSync(file, 'utf-8');
      const relativePath = path.relative(projectRoot, file);
      // Scanned PDFs without a text layer return a placeholder — don't embed
      // it, or it would match unrelated queries.
      if (isPdf && content === '(PDF contains no extractable text)') {
        processed++;
        if (progressCallback) {
          progressCallback({ status: 'indexing', current: processed, total: files.length, file: relativePath });
        }
        continue;
      }
      const chunks = chunkText(content);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await getEmbedding(chunk, backend);

        if (embedding) {
          // Store embedding as JSON blob
          insertStmt.run(relativePath, i, chunk, JSON.stringify(embedding));
          chunksIndexed++;
        }
      }

      processed++;
      if (progressCallback) {
        progressCallback({ status: 'indexing', current: processed, total: files.length, file: relativePath });
      }
    } catch (e) {
      // Skip files that can't be read
    }
  }

  db.close();
  return { chunksIndexed, filesProcessed: processed };
}

// Search for similar chunks. Optionally expands results with one hop of
// wikilink neighbours so questions about a note pick up context from the
// notes it references (and that reference it).
async function searchIndex(query, folderPath, topK = 5, opts = {}) {
  // Check if db exists in ~/.config/vomit/rag/
  const dbPath = getRAGDatabasePath(folderPath);

  if (!fs.existsSync(dbPath)) {
    return { error: 'not_indexed' };
  }

  const queryEmbedding = await getEmbedding(query, opts.backend);
  if (!queryEmbedding) {
    return { error: 'Failed to embed query.' };
  }

  const db = getRAGDatabase(folderPath);
  const rows = db.prepare('SELECT file_path, chunk_index, content, embedding FROM chunks').all();

  // Calculate similarities
  const similarities = rows.map(row => ({
    similarity: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding)),
    chunk: row.content,
    metadata: { file: row.file_path, chunkIndex: row.chunk_index, source: 'similarity' }
  }));

  db.close();

  // Sort by similarity and take top K
  similarities.sort((a, b) => b.similarity - a.similarity);
  const top = similarities.slice(0, topK);

  // Wiki-link expansion: include one extra chunk per neighbour note (out- and
  // in-links of the files in `top`). Capped to avoid exploding the prompt.
  if (opts.expandWithWiki !== false) {
    const wiki = require('./wiki');
    const wikiDbPath = wiki.getWikiDatabasePath(folderPath);
    if (fs.existsSync(wikiDbPath)) {
      try {
        const wDb = new Database(wikiDbPath);
        try {
          const seenFiles = new Set(top.map(t => t.metadata.file));
          const neighbourPaths = new Set();

          for (const t of top) {
            const absSource = path.resolve(folderPath, t.metadata.file);
            // Outbound: links from this file to resolved targets
            const outRows = wDb.prepare(
              'SELECT DISTINCT target_path FROM wikilinks WHERE source_path = ? AND target_path IS NOT NULL'
            ).all(absSource);
            for (const r of outRows) {
              const rel = path.relative(folderPath, r.target_path);
              if (!seenFiles.has(rel)) neighbourPaths.add(rel);
            }
            // Inbound: files that link to this file
            const inRows = wDb.prepare(
              'SELECT DISTINCT source_path FROM wikilinks WHERE target_path = ?'
            ).all(absSource);
            for (const r of inRows) {
              const rel = path.relative(folderPath, r.source_path);
              if (!seenFiles.has(rel)) neighbourPaths.add(rel);
            }
          }

          const maxExtra = typeof opts.maxNeighbourChunks === 'number' ? opts.maxNeighbourChunks : 3;
          if (neighbourPaths.size > 0 && maxExtra > 0) {
            // For each neighbour, pick its single best-scoring chunk.
            const byFile = new Map();
            for (const s of similarities) {
              const f = s.metadata.file;
              if (!neighbourPaths.has(f)) continue;
              if (!byFile.has(f) || byFile.get(f).similarity < s.similarity) {
                byFile.set(f, s);
              }
            }
            const extras = [...byFile.values()]
              .sort((a, b) => b.similarity - a.similarity)
              .slice(0, maxExtra)
              .map(e => ({
                similarity: e.similarity,
                chunk: e.chunk,
                metadata: { ...e.metadata, source: 'wikilink' }
              }));
            top.push(...extras);
          }
        } finally {
          wDb.close();
        }
      } catch {
        // Wiki expansion is best-effort; never fail a RAG search because of it.
      }
    }
  }

  return top;
}

/**
 * Register RAG IPC handlers
 */
function registerHandlers(ipcMain, { state, bus, configStore }) {
  // RAG: Index bucket, or refresh one folder/file within the bucket
  ipcMain.handle('rag-index', async (event, projectRoot, targetPath) => {
    const backend = resolveEmbedBackend(state, configStore);
    if (!backend) {
      return { error: NO_EMBED_BACKEND_ERROR };
    }

    // Send progress updates to both the main window and the detached
    // terminal window so /index status lines appear wherever the user
    // is looking.
    const progressCallback = (progress) => {
      bus.send('rag-progress', progress);
      bus.sendToTerminal('rag-progress', progress);
    };

    try {
      const result = await indexFolder(projectRoot, targetPath, progressCallback, backend);
      if (result.chunksIndexed === 0 && result.filesProcessed > 0) {
        // Every embedding request failed — a wrong model name or a stopped
        // server would otherwise masquerade as a successful empty index.
        return {
          error: backend.kind === 'openai'
            ? `Embedding requests to ${backend.baseUrl} failed for every chunk. Check that the server is running and that the embedding model "${backend.model}" matches one it has downloaded (AI menu → Set Embeddings Model…).`
            : 'Embedding requests to Ollama failed for every chunk. Check that Ollama is running and nomic-embed-text is pulled.'
        };
      }
      return { success: true, indexed: result.chunksIndexed, files: result.filesProcessed };
    } catch (e) {
      return { error: e.message };
    }
  });

  // RAG: Clear current bucket index
  ipcMain.handle('rag-clear', async (event, folderPath) => {
    try {
      const result = clearRAGDatabase(folderPath);
      return { success: true, deleted: result.deleted };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // RAG: Search
  ipcMain.handle('rag-search', async (event, query, folderPath) => {
    const backend = resolveEmbedBackend(state, configStore);
    if (!backend) {
      return { success: false, error: NO_EMBED_BACKEND_ERROR };
    }

    try {
      const results = await searchIndex(query, folderPath, 5, { backend });
      if (results.error) {
        return { success: false, error: results.error };
      }
      // Format chunks for renderer
      const chunks = results.map(r => ({
        file: r.metadata.file,
        content: r.chunk,
        similarity: r.similarity,
        source: r.metadata.source || 'similarity'
      }));
      return { success: true, chunks };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = {
  chunkText,
  cosineSimilarity,
  getEmbedding,
  resolveEmbedBackend,
  getRAGDatabasePath,
  getRAGDatabase,
  clearRAGDatabase,
  indexFolder,
  searchIndex,
  registerHandlers
};

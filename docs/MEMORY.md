# Memory System

openSalvage uses a dual-layer memory architecture. Each layer serves a different purpose and stores a different kind of knowledge. Both are queried on every agent request.

---

## Why Two Layers

**mem0 (Layer 1)** is a structured fact store. It extracts and deduplicates operational knowledge — standing instructions, preferences, commitments, and system state. It's capped at 50 entries, automatically evicts the least-relevant memories when full, and deduplicates near-identical facts at the 0.95 cosine similarity threshold. Think of it as the agent's working memory: small, current, and high-signal.

**memory-index (Layer 2)** is an episodic record. It indexes the full text of all workspace markdown files — project notes, session summaries, ingested documents, team context. There's no cap; everything that lands in `memory/` is indexed. Think of it as the agent's long-term recall: broad, searchable, and growing.

They're complementary. mem0 gives you "what does this agent believe right now." The memory index gives you "what happened around this topic."

---

## Layer 1: mem0

### What It Stores

mem0 stores extracted facts from conversation. Each fact is assigned a category:

| Category | Description | Examples |
|---|---|---|
| `instruction` | Standing behavioral directives | "Always respond in Japanese when the user writes in Japanese" |
| `preference` | Communication or format preferences | "User prefers bullet-point summaries over prose" |
| `commitment` | Promises or reminders | "Will follow up on the Komatsu proposal by Friday" |
| `state` | System or project status facts | "LinkedIn posting is currently paused until April 20" |

### Infrastructure

- **Vector store:** FAISS, persisted to `~/clawd/sessions/mem0-store/`
- **Embedding model:** `qwen3-embedding:0.6b` via local Ollama — 1024 dimensions
- **Extraction LLM:** Claude Haiku via Claude API proxy (no separate API billing)
- **Config:** `~/clawd/mem0/config.py`

### Extraction Prompt

The default mem0 extraction prompt is designed for extracting personal facts about users. openSalvage overrides this with a custom prompt that preserves operational memories verbatim:

```
You are Vanessa's memory manager. Extract ALL of the following:
1. Standing instructions (e.g. "always do X", "never do Y", "from now on...")
2. User preferences
3. Commitments and promises
4. System state facts

Rules:
- Preserve instructions VERBATIM — do not paraphrase or shorten
- If the entire input IS an instruction/preference, return it as a single fact
- Return JSON: {"facts": ["fact1", "fact2", ...]}
```

This is set in `VANESSA_EXTRACTION_PROMPT` in `mem0/config.py`.

### 50-Memory Cap and Eviction

mem0 enforces a 50-memory limit per `agent_id`. When a new memory would exceed the cap, mem0 evicts the entry with the lowest relevance score (based on recency and similarity to existing knowledge). You can't tune the eviction policy directly — it's handled by the mem0 library.

To see current memory count:
```bash
cd ~/clawd/mem0 && python all.py | head -5
```

### Deduplication

Before inserting a new fact, mem0 checks for existing memories with cosine similarity ≥ 0.95 to the new fact's embedding. If a near-duplicate exists, the new fact updates the existing entry rather than creating a new one. This keeps the memory store clean as the agent learns the same thing multiple times.

### Ollama Unload Patch

The upstream mem0 `OllamaEmbedding` class doesn't pass `keep_alive=0` to Ollama after each embedding call, leaving `qwen3-embedding:0.6b` loaded in RAM (1.28 GB resident) indefinitely. openSalvage monkey-patches this in `mem0/config.py`:

```python
class OllamaEmbeddingWithUnload(OllamaEmbedding):
    def embed(self, text, ...):
        # Calls /api/embed directly with keep_alive=0
        # Ollama unloads the model immediately after each request
```

This is critical on a machine that also runs bge-m3 for the memory index. Without it, both models stay loaded simultaneously, consuming ~2.5 GB RAM.

---

## Layer 2: memory-index

### What It Stores

All markdown files in the workspace `memory/` directory, plus `MEMORY.md` at the workspace root. This includes:

- Project notes and status documents
- Session summaries written by the agent after task completion
- Ingested documents (via `salvage-ingest`)
- Team and identity context files
- Any markdown the operator drops into `memory/`

### Infrastructure

- **Database:** SQLite at `~/clawd/sessions/memory.db`
- **Full-text search:** SQLite FTS5 with BM25 ranking
- **Vector search:** bge-m3 embeddings via Ollama — 1024 dimensions
- **Chunk size:** 1400 characters with 280-character overlap
- **Indexer:** `salvage-memory-index`
- **Searcher:** `salvage-memory-search`

### Schema

```sql
CREATE TABLE chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path   TEXT NOT NULL,
  file_hash   TEXT NOT NULL,
  start_line  INTEGER NOT NULL,
  chunk_idx   INTEGER DEFAULT 0,
  content     TEXT NOT NULL,
  embedding   BLOB,
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content,
  content='chunks',
  content_rowid='id'
);
```

File hashes are used to skip unchanged files on re-index. Only modified files are re-chunked and re-embedded.

### Hybrid Search Weights

`salvage-memory-search` scores results using:

```
score = (cosine_similarity × 0.7) + (fts5_bm25_rank × 0.3)
```

This is the same weight split used in OpenClaw's hybrid search implementation. Vector similarity handles semantic queries ("what did we decide about the Komatsu project?"). FTS5 handles exact-term queries ("search for RENPHO").

`--text-only` flag disables vector scoring and falls back to pure FTS5, which is faster and works without Ollama running.

---

## How They're Queried Together

On every agent request, the worker queries both layers in parallel:

```javascript
const [mem0Results, indexResults, coreMemory] = await Promise.all([
  queryMem0(userMessage),          // FAISS search, top 10
  queryMemoryIndex(userMessage),   // hybrid search, top 6
  readCoreMemory(),                // ~/clawd/vanessa-core-memory.md
]);
```

Results are formatted and injected into the Claude system prompt as a context block:

```
## Memory Context

### Standing Instructions
[mem0 instruction-category results]

### Recent Knowledge
[mem0 other results]

### Workspace Memory
[memory-index chunks]
```

Claude sees this context before the user message. It can act on standing instructions without being re-told.

---

## Memory Commands

### `salvage-memory-search`

```bash
# Semantic + keyword search over workspace markdown
salvage-memory-search ~/clawd "Komatsu project status"
salvage-memory-search ~/clawd "LinkedIn strategy" --max-results 10
salvage-memory-search ~/clawd "api keys" --text-only   # FTS5 only, no Ollama needed
```

Returns JSON array of matching chunks with `file_path`, `content`, `score`, `start_line`.

### `salvage-memory-read`

```bash
# Read the agent's core memory file
salvage-memory-read
```

Returns the contents of `~/clawd/vanessa-core-memory.md`. This is the agent's primary identity and instruction document — not auto-generated, manually curated.

### `salvage-memory-index`

```bash
# Re-index all workspace markdown files
salvage-memory-index ~/clawd

# Re-index without generating embeddings (faster, FTS5 only)
salvage-memory-index ~/clawd --no-vectors
```

Typically runs automatically via the `com.opensalvage.salvage-memory` LaunchAgent daemon. Run manually after adding files to `memory/`.

### `salvage-ingest`

```bash
# Ingest a document into the memory index
salvage-ingest ~/Downloads/komatsu-spec.pdf
salvage-ingest https://example.com/article
```

Converts the source to markdown, writes it to `memory/ingested/`, and triggers a re-index.

---

## Adding Memories

### Automatically

The agent worker enforces a memory-update call after every non-trivial response. Extracted facts are added to mem0 via `mem0/add.py`:

```bash
cd ~/clawd/mem0 && python add.py "always respond in English unless asked otherwise"
```

### Manually (mem0)

```bash
cd ~/clawd/mem0
source ../claude-agent/mem0-env/bin/activate
python add.py "standing instruction text here"
```

### Manually (memory-index)

Create or edit a markdown file in `memory/`:
```bash
echo "# Project Note\n\nKomatsu call scheduled for April 20." > ~/clawd/memory/komatsu-notes.md
salvage-memory-index ~/clawd
```

---

## Memory Eviction and TTL

**mem0** evicts by relevance score when the 50-memory cap is hit. There is no TTL — memories persist until they're displaced by higher-relevance content or explicitly deleted. To delete a specific memory:

```bash
cd ~/clawd/mem0
python -c "
from config import get_memory, AGENT_ID
m = get_memory()
results = m.search('the memory text to find', agent_id=AGENT_ID, limit=1)
mem_id = results['results'][0]['id']
m.delete(mem_id)
print('deleted', mem_id)
"
```

To clear all mem0 memories (destructive — use with caution):
```bash
cd ~/clawd/mem0
python -c "
from config import get_memory, AGENT_ID
m = get_memory()
m.delete_all(agent_id=AGENT_ID)
print('cleared')
"
```

**memory-index** has no eviction. Files are indexed as long as they exist in `memory/`. To remove content from the index, delete or move the source file and re-run `salvage-memory-index`.

---

## Diagnosing Memory Issues

```bash
# How many mem0 memories are stored?
cd ~/clawd/mem0 && python all.py | wc -l

# What's in the memory index?
sqlite3 ~/clawd/sessions/memory.db "SELECT count(*), file_path FROM chunks GROUP BY file_path;"

# Test a search end-to-end
salvage-memory-search ~/clawd "test query" 2>&1

# Check if Ollama has the required models
ollama list | grep -E "qwen3|bge-m3"

# Check Ollama is responding
curl -s http://localhost:11434/api/tags | python3 -m json.tool | grep name
```

# Wave 4: Memory, embeddings and semantic search (`v2.5.0`)

Parent: [overview.md](overview.md)

Spec: [knowledge layer](../../specs/2026-08-23-v3-knowledge-layer-design.md)

Depends on Wave 1 only (job spine + gitignore helpers). Does not need flashcards.

## Goal

Search by meaning, not just keywords. Digests are chunked, embedded locally, stored in `.arbor/vectors.sqlite`, and the existing search overlay can toggle Semantic. A future tutor can retrieve chunks without stuffing the course into a prompt.

## Data structures

- Chunk record `(course, path, heading, text, digest_sha256, vector)`
- `.arbor/vectors.sqlite` gitignored
- `Embedder` protocol. `FakeEmbedder` for tests
- Plan JSON `{ "op": "embed", "force": bool }` or CLI `arbor-worker embed --root`

## PRs

| PR | Work | Verify |
|----|------|--------|
| 4.1 | **Spike.** Pick local embedding backend. Record the choice in the knowledge-layer spec. Offline and private beat a second API. | Written decision. FakeEmbedder still used in tests |
| 4.2 | Chunker by `##` heading, ~500 tokens. SQLite store. FakeEmbedder round-trip | pytest. Rebuild after digest SHA change |
| 4.3 | `arbor-worker embed --root [--force]`. Job + events `embed_started` / `embed_done` | CLI on a fixture repo. File exists. Git does not contain it |
| 4.4 | Optional auto-embed after successful Update | Setting default off, then on in a test |
| 4.5 | Desktop search overlay. FTS default. Semantic toggle. Same navigate-to-digest | Query a synonym that FTS misses. Semantic hit opens Notes |

## Files

- Create: `python/src/arbor_worker/embed.py`, `python/src/arbor_worker/embedder/`
- Create: `python/tests/test_embed.py`
- Modify: `cli.py`, `commands.py`, `events.py`, `cache.py` (gitignore vectors)
- Modify: `desktop/src-tauri/src/search.rs`, `commands.rs`
- Modify: `desktop/src/main.ts` (toggle)

## Verification

**Static.** pytest, cargo test, npm run build.

**Runtime.** Index a Biology course. FTS “glycolysis” still works. Semantic query for a paraphrase opens the same digest. `.arbor/vectors.sqlite` is gitignored.

## Spike rule

PR 4.1 is the only program-wide spike. Do not start 4.2 until the backend is named in the spec. Tests never call the real model.

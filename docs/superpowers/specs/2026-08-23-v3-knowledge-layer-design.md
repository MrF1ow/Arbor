# Version 3 knowledge layer (memory, graph, grounding)

Date: 2026-08-23

Status: design. Required for `v3.0.0`. Program: [`../plans/2026-08-22-v3-program/overview.md`](../plans/2026-08-22-v3-program/overview.md). Study JSON skills: [`2026-08-22-v3-study-artifacts-format.md`](2026-08-22-v3-study-artifacts-format.md).

## Problem

A student will download Arbor when it is a study app that also holds a library an AI can query without rereading every digest. Keyword FTS finds words. It does not remember meaning, related ideas, or whether a claim is actually in the notes.

Version 4 is chat. Version 3 must leave behind local memory and a graph that chat can use. If those wait for the tutor, the tutor has nothing cheap to stand on.

## What this layer is

Three stores, all derived from committed `digests/*.md`.

| Store | Job | On disk |
|-------|-----|---------|
| **Memory** | Retrieve related passages | `.arbor/vectors.sqlite` (gitignored) |
| **Graph** | Named concepts and links across digests | `study/concepts.json` (committed) |
| **Grounding** | Figures become concepts. Claims point at digest text that actually contains them. | Same graph file, plus verification events |

Markdown digests stay the source of truth. These stores rebuild from digests. They do not replace them.

## Layout

```
Biology/
  digests/
    2026-08-15.md
  study/
    manifest.json
    flashcards.json
    quiz.json
    concepts.json
  arbor-course.json
  course.md
.arbor/
  arbor.db
  vectors.sqlite
  progress/
```

Worker `ensure_gitignored` must list `.arbor/progress/` and `.arbor/vectors.sqlite`. Do not gitignore all of `.arbor` (settings live there).

## Memory (embeddings)

Chunk each digest by `##` heading, roughly 500 tokens, keep a pointer to `path` plus heading. Embed each chunk. Store `(course, path, heading, text, digest_sha256, vector)`.

Search overlay keeps FTS as the default. A Semantic toggle runs cosine over vectors and navigates the same way FTS does (course, Notes, digest).

**Embedder protocol** (Python, same idea as `CliProvider`):

- `embed(texts: list[str]) -> list[list[float]]`
- Tests use `FakeEmbedder` (stable hash to a unit-ish vector).
- Production uses a local hashed n-gram embedder from the Python standard library. It splits text on whitespace and punctuation, hashes 1-3 token grams into a 256-dimension signed bag, and L2-normalizes the result. It runs offline and sends no library text over the network.
- Brute-force cosine is enough for v1. Course libraries are small.

CLI: `arbor-worker embed --root <Knowledge>` and optional auto-run after a successful update. Out of the digest generate path.

Rebuild is `arbor-worker embed --root --force`. Stale chunks follow digest SHA-256, same spirit as `study/manifest.json`.

## Graph (concepts plus links)

One skill, `concepts`, writes `study/concepts.json`.

```json
{
  "schema_version": 1,
  "course": "Biology",
  "nodes": [
    {
      "id": "glycolysis",
      "name": "Glycolysis",
      "summary": "Cytoplasmic breakdown of glucose to pyruvate.",
      "sources": [
        {"digest": "digests/2026-08-15.md", "heading": "Glycolysis"}
      ]
    }
  ],
  "edges": [
    {
      "from": "glycolysis",
      "to": "pyruvate",
      "relation": "produces",
      "sources": [
        {"digest": "digests/2026-08-15.md", "heading": "Glycolysis"}
      ]
    }
  ]
}
```

Node ids are slugs from normalized `name`, so a later tutor can ask for neighbors without fuzzy matching. Duplicate names in one course merge sources.

**Cross-document linking** is the edges (and `sources` that span more than one digest). There is no second file format.

**UI (graph-lite).** Notes mode shows related concept chips under the open digest. A Graph panel lists concepts and their neighbors. Clicking a source opens Notes at that digest. No force-directed canvas in v3. A tutor in v4 queries the JSON, not the pixels.

Stale badge uses the same manifest `content_sha256` pattern as flashcards.

## Diagram analysis

Lecture PDFs are full of figures. If figures never become concepts, memory is incomplete.

Skill `diagrams` runs after digests exist. It may attach page images already produced by prepare (same `image_paths` the digest path uses). It must not re-ingest PDFs.

Output merges into `study/concepts.json` (new nodes with `"kind": "figure"` and a source heading or page marker). Do not invent a parallel figure store.

If a page has no usable figure, skip it. Empty result is success, not failure.

## Citation verification

Every study artifact already carries `source.digest` and optional `source.heading` (see study format spec). Verification is local. Arbor does not fetch the web.

Skill `citations` walks flashcards, quiz items, and concept nodes. For each claim it checks every cited digest: the file exists and a normalized form of the claim (or a short quoted span) appears in that digest body. Failures emit `citation_failed` with path and id, and are also written to `study/citations.json` so the desktop can badge unverified items after restart without rewriting flashcards, quiz, or concepts. Prior study JSON stays in place. The UI shows a badge, not a silent rewrite.

This is the trust layer a tutor needs before it quotes a card as fact.

## Versioning

Same three layers as study artifacts. `schema_version` in the JSON, `skill_version` in the manifest, digest SHA-256 for staleness. Vectors are derived and have no schema in git.

## Worker / desktop

| Command | Role |
|---------|------|
| `arbor-worker generate --skill concepts` | Graph JSON |
| `arbor-worker generate --skill diagrams` | Merge figure nodes |
| `arbor-worker generate --skill citations` | Verify, emit events |
| `arbor-worker embed --root` | Rebuild vectors |
| `start_study_job` | Existing generate mutex |
| embed job | Same mutex, different plan JSON |

Events reuse `skill_*` plus `embed_started`, `embed_done`, `citation_failed`.

## Out of scope

- Chat / tutor (Version 4). v4 reads these stores. It does not create them.
- Remote vector DBs, cloud sync.
- Pretty graph visualization, Anki export, multi-provider embeddings APIs as a requirement.

## Success

A classmate can search by meaning, see that glycolysis links to pyruvate across two lectures, and trust that a card's back is in the digest it cites. A later tutor can retrieve chunks and walk neighbors without stuffing the whole course into a prompt.

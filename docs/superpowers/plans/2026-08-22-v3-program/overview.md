# Arbor Version 3 program

> **Goal:** Ship the student-trustworthy shell, then knowledge enhancement (flashcards, quiz, search upgrades) on top of it — without breaking the v2 ingest loop.

**Format contract:** [`docs/superpowers/specs/2026-08-22-v3-study-artifacts-format.md`](../../specs/2026-08-22-v3-study-artifacts-format.md)

**Shell design:** [`docs/superpowers/specs/2026-08-22-v3-desktop-shell-design.md`](../../specs/2026-08-22-v3-desktop-shell-design.md)

## Context

- **2.0.0** shipped automation (jobs, FTS, watch, OCR, Word) on the v1 UI.
- **2.1.0** shipped the desktop shell on `main` (Wave 0). Version 3 is **in progress**.
- **`v3.0.0` is reserved** for full Version 3 completion (all PROJECT.md v3 features).
- **Flashcards / quiz / embeddings** are planned in Waves 1–5; no worker code yet.

## Scope

### In Version 3

| Track | Deliverable |
|-------|-------------|
| **Shell** | Sage/cream UI, course browser, digest preview, jobs/settings places |
| **Study framework** | Skill interface, `study/manifest.json`, generate jobs, validate/retry |
| **Flashcards** | Skill + Flashcards mode UI + refresh |
| **Quiz** | Skill + Quiz mode UI + refresh |
| **Embeddings** | Local vector index + semantic search in existing search slot |
| **Concepts** (stretch) | Extracted concept list per course, links between digests |

### Out of Version 3

- Chat / tutor (Version 4)
- Multiple AI providers (later)
- Scheduler
- Cloud sync (Version 5)
- Diagram analysis, citation verification, full knowledge graph UI (v3 stretch or v3.5)

## Core architectural answers

### When are flashcards created?

**Post-ingestion**, by default. Optional auto-generate after a successful Update (settings toggle).

Digest generation does not change. Study skills read committed `digests/*.md`.

### How does Codex return structured data?

Separate skill invocation per artifact. Prompt demands **JSON only**. Pydantic validation + up to 2 retries. Output via existing `codex exec -o` file read. See format spec.

### How do we version?

- `schema_version` in each JSON file
- `skill_version` + source digest SHA-256 in `study/manifest.json`
- Git history for committed study files
- User progress in `.arbor/progress/` (local, not versioned)

### How does refresh work?

`Generate` / `Refresh from digests` → `arbor-worker generate --skill flashcards [--force]` → re-read all course digests → hash compare → Codex if stale or forced → validate → write → commit.

## Throughput checkpoint

```
Wave 0 (shell) ──must finish──▶ Wave 1 (study framework)
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
              Wave 2 (flashcards)  Wave 3 (quiz)    Wave 4 (embeddings)
                    │                   │
                    └─────────┬─────────┘
                              ▼
                    Wave 5 (concepts / graph-lite)
```

Waves 2 and 3 can run in parallel after Wave 1. Wave 4 needs indexer design but not flashcards.

## Waves

### Wave 0 — Shell (`v2.1.0`)

**Status:** shipped on `main` (2026-08-22). Package **`v2.1.0`** — not `v3.0.0`.

- [x] Window 1100×760, sage/cream tokens
- [x] Sidebar: Library, Jobs, Settings (bottom)
- [x] Course modes: Notes / Flashcards / Quiz tabs
- [x] Notes: digest index + markdown preview
- [x] Inspector: Update, review, log (collapsed default)
- [x] Settings UI → `.arbor/settings.json`
- [x] Search overlay → navigate to digest in Notes
- [x] Dark mode (`prefers-color-scheme`)
- [x] Tag `v2.1.0`, update README/CHANGELOG
- [ ] Mac E2E ingest regression documented on `main`

**Verify:** full PDF ingest, confirm, commit, search, watch review — on new UI.

---

### Wave 1 — Study artifact framework (`3.1.0`)

**Goal:** One pluggable skill path end-to-end with a noop or tiny fixture skill before flashcards.

**Python**

- `skills/base.py` — `StudySkill` protocol: `name`, `build_prompt`, `validate`, `run`
- `skills/manifest.py` — load/save `study/manifest.json`, SHA-256 digest files, staleness check
- `schemas/study/` — Pydantic models + JSON Schema files
- `commands.py` — `generate` subcommand
- `events.py` — `skill_*` event types
- Tests: validate fixtures, stale skip, retry on bad JSON

**Rust**

- `start_study_job` command (parallel to `start_update`, same coordinator mutex)
- Plan JSON: `{ "course", "skill", "force" }`

**Desktop**

- Replace Coming soon with empty state + **Generate** (disabled until framework lands; wire in Wave 2)
- Job events in inspector log

**Verify:** `arbor-worker generate --skill flashcards` against a fixture provider (`FakeProvider` returns valid JSON).

---

### Wave 2 — Flashcards (`3.2.0`)

**Python**

- `skills/flashcards.py` — prompt from all course digests (or per-digest merge)
- Write `study/flashcards.json` + update manifest
- Git commit on success

**Desktop**

- Flashcards mode: card flip, next/prev, shuffle
- **Refresh from digests** button
- Stale badge from manifest
- Source link → Notes + digest
- Progress in `.arbor/progress/Biology.flashcards.json`

**Settings**

- `auto_generate.flashcards` (default `false`)

**Verify:** generate deck from real Biology digests; refresh after digest edit marks stale then regenerates; progress survives refresh for unchanged card IDs.

---

### Wave 3 — Quiz (`3.3.0`)

Same framework as Wave 2.

- `skills/quiz.py` → `study/quiz.json`
- Quiz mode UI: MCQ flow, explanation after answer
- Refresh + stale badge
- `auto_generate.quiz` setting

**Verify:** 10+ question pack from multi-digest course; failed validation retries; git commit.

---

### Wave 4 — Embeddings + semantic search (`3.4.0`)

**Python**

- Chunk digests (by heading or fixed token windows)
- Embed via provider (initially Codex or local model TBD — **spike required**)
- Store in `.arbor/vectors.sqlite` (derived, reindex command)

**Rust / desktop**

- Search overlay: keyword (FTS) + semantic toggle
- Same navigate-to-digest behavior

**Out of digest path.** Post-ingest `arbor-worker embed --root` or auto after generate wave.

---

### Wave 5 — Concepts (stretch, `3.5.0`)

- `skills/concepts.py` → `study/concepts.json` (nodes + edges)
- Notes mode: optional "related concepts" chips
- Not a full graph visualisation yet — list + links first

---

## Release map

Package tags during Version 3 work use **`v2.x`**. Tag **`v3.0.0` only when the full Version 3 milestone ships** (all features in PROJECT.md Version 3).

| Tag | Wave | User-visible |
|-----|------|----------------|
| `v2.1.0` | 0 | Desktop shell — "looks like a notes app" |
| `v2.2.0` | 1 | Study artifact framework |
| `v2.3.0` | 2 | Flashcards work + refresh |
| `v2.4.0` | 3 | Quiz works + refresh |
| `v2.5.0` | 4 | Semantic search |
| `v2.6.0` | 5 | Concepts (stretch) |
| **`v3.0.0`** | **all** | **Version 3 complete** |

## Verification (every wave)

```bash
cd python && uv run pytest -q
cd desktop/src-tauri && cargo test
cd desktop && npm run build
# Manual: pick Knowledge folder → Update → Confirm → commit → search → open Flashcards/Quiz
```

Mac E2E ingest path from v2 must keep passing through Wave 0.

## Constraints (unchanged)

- Markdown digests = source of truth
- SQLite / vectors / progress = derived or local
- Codex CLI external
- Rust orchestrates, Python thinks
- One update job at a time; study generate jobs use same mutex

## Open spikes (before Wave 4)

1. **Embedding provider** — Codex vs local (Ollama) vs API; cost and offline behavior.
2. **Card ID stability on refresh** — hash of normalized `front` vs model-assigned IDs.
3. **Per-digest vs per-course generation** — v1: whole course in one call; split if token limits bite.

## Documentation debt (this program)

- [x] CHANGELOG 2.1.0 notes (Wave 0, on `main`)
- [x] README shell description (Wave 0, on `main`)
- [x] `desktop/README.md` update (Wave 0, on `main`)
- [ ] Wave detail docs (optional, like v2 `wave-*.md`) as each wave starts
- [ ] Mac E2E checklist run recorded in this doc

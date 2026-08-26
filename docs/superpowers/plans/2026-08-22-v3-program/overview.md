# Arbor Version 3 program

> **Goal:** Ship a study app a student would download, with local memory and a concept graph an AI can query, without breaking the v2 ingest loop.

**Versioning:** Product Version 3 is built as package **`v2.x`**. `v2.1.0` was the shell. Waves 1 through 8 land together as package **`2.2.0`**. Do not backfill `v2.3.0` through `v2.8.0`. The operator tags **`v2.2.0`** after this package bump lands. Tag **`v3.0.0` only when every required feature below is done and the Mac E2E run is recorded.** Never publish `3.1.0` or `3.2.0`. See [PROJECT.md Version numbering](../../../../PROJECT.md#version-numbering) and [`.cursor/rules/arbor-versioning.mdc`](../../../../.cursor/rules/arbor-versioning.mdc).

**Format contract:** [`docs/superpowers/specs/2026-08-22-v3-study-artifacts-format.md`](../../specs/2026-08-22-v3-study-artifacts-format.md)

**Knowledge layer:** [`docs/superpowers/specs/2026-08-23-v3-knowledge-layer-design.md`](../../specs/2026-08-23-v3-knowledge-layer-design.md)

**Shell design:** [`docs/superpowers/specs/2026-08-22-v3-desktop-shell-design.md`](../../specs/2026-08-22-v3-desktop-shell-design.md)

**Closeout:** [`docs/superpowers/specs/2026-08-23-v3-closeout-design.md`](../../specs/2026-08-23-v3-closeout-design.md). Tracking issue [#42](https://github.com/MrF1ow/Arbor/issues/42).

## Context

- **2.0.0** shipped automation (jobs, FTS, watch, OCR, Word) on the v1 UI.
- **2.1.0** shipped the desktop shell (Wave 0). Version 3 is **in progress**.
- Waves 1 through 8 are in package **2.2.0** (PRs #36 through #41, #47, #50, #51, and this docs bump).
- **`v3.0.0` is reserved** for the full milestone. Code for flashcards, quiz, memory, graph, diagrams, citations, grades, session answers, and heading scroll exists. The Mac E2E record does not.

## Scope

Version 3 is the first Arbor a student would download **and** the memory Version 4 (tutor) will query. That means a study loop, retrieval memory, a concept graph, and grounding.

### In Version 3 (required for `v3.0.0`)

| Track | Deliverable | Wave | Status |
|-------|-------------|------|--------|
| **Shell** | Sage/cream UI, course browser, digest preview, jobs/settings | 0 (`v2.1.0`) | Shipped |
| **Study framework** | Skill protocol, `study/manifest.json`, `generate` jobs, validate/retry | 1 (PR #36) | On `main` |
| **Flashcards** | Skill + mode UI + refresh + local progress | 2 (PR #37) | On `main` |
| **Quiz** | Skill + mode UI + refresh | 3 (PR #39) | On `main` |
| **Memory** | Local vectors + semantic search in the existing search slot | 4 (PR #38) | On `main` |
| **Graph** | Concepts, cross-document edges, graph-lite UI | 5 (PR #40) | On `main` |
| **Diagrams** | Figure concepts merged into the graph | 6 (PR #41) | On `main` |
| **Citations** | Local verification that claims appear in cited digests | 7 (PR #41) | On `main` |
| **Closeout** | Grade buttons, quiz session answers, heading scroll, living docs, Mac E2E | 8 (`v2.2.0`) | Package 2.2.0. Mac E2E still open. [#42](https://github.com/MrF1ow/Arbor/issues/42) |

### Out of Version 3

- Chat / tutor (Version 4). v4 reads memory and graph. It does not create them.
- Multiple AI providers
- Scheduler (folder watch covers the ingest case)
- Cloud sync (Version 5)
- Anki export, pretty graph canvas, remote vector DBs
- Make-card-from-selection (shell spec: later refinement)

If issue #42 lists an out-of-v3 item, file it for Version 4 or later. Do not pull it into Wave 8.

## Locked decisions

These are not spikes. Implementers follow them.

**When are study artifacts created?** After ingest, as separate jobs. Digests stay the source of truth. Optional `auto_generate.<skill>` after a successful Update (default `false`).

**How does Codex return JSON?** One skill, one `provider.run`, one file. Prompt says JSON only. Pydantic parse + up to 2 retries (3 attempts). `ProviderResult.markdown` is the raw text payload. Skills call `json.loads` on it. `FakeProvider` already returns that field. Tests pass a JSON string as `markdown`. Do not add a second provider type.

**Retries.** Helper on the skill path (`skills/base.py`). The digest pipeline does **not** retry (`pipeline.py` raises on `DigestError`). Leave digest behavior unchanged.

**Card / question ids.** Worker computes `id` as a short hash of normalized `front` (or quiz prompt) plus `source.digest`. Model-supplied ids are ignored. Progress in `.arbor/progress/` keys off that id. Unchanged cards keep progress across refresh.

**Per-course vs per-digest.** One generate call per course, concatenating digests with headings. If combined text exceeds the skill’s character budget, split per digest, merge, and drop duplicate fronts.

**Jobs.** Reuse `JobCoordinator` mutex. `JobTrigger::Study`. Plan JSON is `{ "course", "skill", "force" }`. Error copy is “A job is already running for {root}”.

**Git.** Successful generate commits `study/manifest.json` and the artifact file. Progress, vectors, and `arbor.db` stay local. `.arbor/progress/` and `.arbor/vectors.sqlite` are gitignored.

**pydantic.** Already in `python/pyproject.toml` (Wave 1).

**Flashcard grade (Wave 8).** Again / Wrong / Mastered write `seen` / `wrong` / `correct`. Flip and Next do not grade. No due dates.

**Quiz session (Wave 8).** Each question id is scored at most once per open session. Previous/Next restore the submitted choice.

**Heading scroll (Wave 8).** Source chips open Notes and scroll to the heading id when present.

**Tags.** Do not backfill `v2.2.0`–`v2.8.0`. Next tag is `v2.2.0` for Wave 8 plus the unreleased waves already on `main`.

## Throughput checkpoint

```
Wave 0 (shell) shipped
        │
        ▼
Waves 1–7 on main (PRs #36–#41)
        │
        ▼
Wave 8 (closeout, issue #42) ──package 2.2.0──▶ operator tags v2.2.0
        │
        ▼
Mac E2E recorded
        │
        ▼
     v3.0.0
```

## Waves

0. [mac-e2e](mac-e2e.md). Mac ingest plus study-loop checklist (open until recorded)
1. [wave-1-study-framework](wave-1-study-framework.md). Skill protocol, `generate`, jobs, retries (PR #36)
2. [wave-2-flashcards](wave-2-flashcards.md). Deck skill + UI (PR #37)
3. [wave-3-quiz](wave-3-quiz.md). Quiz skill + UI (PR #39)
4. [wave-4-memory](wave-4-memory.md). Embeddings + semantic search (PR #38)
5. [wave-5-graph](wave-5-graph.md). Concepts, links, graph-lite (PR #40)
6. [wave-6-diagrams](wave-6-diagrams.md). Figures into the graph (PR #41)
7. [wave-7-citations](wave-7-citations.md). Local citation checks (PR #41)
8. [wave-8-closeout](wave-8-closeout.md). Grade, session answers, heading scroll, docs, E2E ([#42](https://github.com/MrF1ow/Arbor/issues/42))

## Release map

| Tag | Wave | User-visible |
|-----|------|----------------|
| `v2.1.0` | 0 | Desktop shell |
| `v2.2.0` | 1–8 | Generate, flashcards, quiz, semantic search, graph, figures, citation badges, grade buttons, stable quiz scores, heading scroll, docs that match the app |
| **`v3.0.0`** | **all + Mac E2E** | **Version 3 complete** |

## Verification (every wave)

```bash
cd python && uv run pytest -q
cd desktop/src-tauri && cargo test
cd desktop && npm test
cd desktop && npm run build
```

Manual on Mac. Pick Knowledge folder → Update → Confirm → commit → search. Then exercise the wave’s mode (Generate / flip / grade / quiz / semantic toggle / concept chip). v2 ingest must still pass.

No `control-ui` skill is wired for this Tauri app. Runtime checks are pytest, cargo test, `npm test`, `npm run build`, and the Mac checklist in [mac-e2e.md](mac-e2e.md).

## Constraints (unchanged)

- Markdown digests = source of truth
- SQLite / vectors / progress = derived or local
- Codex CLI external
- Rust orchestrates, Python thinks
- One job at a time

## Embedding backend (Wave 4, closed)

Production embedder is a local hashed 1-3 gram bag into 256 dimensions, L2-normalized. Stdlib only. Tests use `FakeEmbedder`. Recorded in the knowledge-layer spec.

## Implementation guidance

- Run the **how** skill on `python/src/arbor_worker/commands.py`, `desktop/src-tauri/src/commands.rs`, and `desktop/src-tauri/src/jobs.rs` before changing the job spine.
- TDD. Red tests first, as in v2 waves.
- `/deslop` before commit. **unslop** on any prose.
- Cursor **babysit** after the PR opens.

## Documentation debt

- [x] CHANGELOG 2.1.0 notes (Wave 0, on `main`)
- [x] README shell description (Wave 0, on `main`)
- [x] `desktop/README.md` update (Wave 0, on `main`)
- [x] Wave detail docs (this folder)
- [x] README / PROJECT.md / desktop README match waves 1–8 (package 2.2.0)
- [ ] Mac E2E checklist run recorded in [mac-e2e.md](mac-e2e.md)

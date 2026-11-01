# Arbor Version 3 program

> **Goal:** Ship a study app a student would download, with local memory and a concept graph an AI can query, without breaking the v2 ingest loop.

**Versioning:** Product Version 3 shipped as package **`v2.x`**. `v0.2.1` is the shell. Waves 1 through 8 shipped together in **`v0.2.2`**. **`v0.2.3`** is the current tag: Mac-batch fixes, Notes leftovers, and path/CSP. Do not invent `v0.2.4` through `v0.2.8` for those waves. Tag **`v0.3.0` only after a clean Mac E2E run of `v0.2.3`.** After that, Version 4 ships as `v0.3.1`, `v0.3.2`, and so on, until `v0.4.0`. See [PROJECT.md Version numbering](../../../../PROJECT.md#version-numbering) and [`.cursor/rules/arbor-versioning.mdc`](../../../../.cursor/rules/arbor-versioning.mdc).

**Format contract:** [`docs/superpowers/specs/2026-08-22-v3-study-artifacts-format.md`](../../specs/2026-08-22-v3-study-artifacts-format.md)

**Knowledge layer:** [`docs/superpowers/specs/2026-08-23-v3-knowledge-layer-design.md`](../../specs/2026-08-23-v3-knowledge-layer-design.md)

**Shell design:** [`docs/superpowers/specs/2026-08-22-v3-desktop-shell-design.md`](../../specs/2026-08-22-v3-desktop-shell-design.md)

**Closeout:** [`docs/superpowers/specs/2026-08-23-v3-closeout-design.md`](../../specs/2026-08-23-v3-closeout-design.md). Wave 8 study-loop code is on `main`. GitHub [#42](https://github.com/MrF1ow/Arbor/issues/42) is Notes UX leftover, not this closeout. Status ledger: [`docs/implementation-checklist.md`](../../../implementation-checklist.md).

## Context

- **0.2.0** shipped automation (jobs, FTS, watch, OCR, Word) on the v1 UI.
- **0.2.1** shipped the desktop shell (Wave 0). Version 3 is **in progress**.
- Waves 1 through 8 shipped in **`v0.2.2`** (PRs #36 through #41, #47, #50, #51).
- **`v0.2.3`** is the current release: issue #57 fixes, Notes leftovers, and path/CSP (#64).
- **`v0.3.0` is reserved** for the full milestone. The code is on `main`. A clean Mac E2E record is not.

## Scope

Version 3 is the first Arbor a student would download **and** the memory Version 4 (tutor) will query. That means a study loop, retrieval memory, a concept graph, and grounding.

### In Version 3 (required for `v0.3.0`)

| Track | Deliverable | Wave | Status |
|-------|-------------|------|--------|
| **Shell** | Sage/cream UI, course browser, digest preview, jobs/settings | 0 (`v0.2.1`) | Shipped |
| **Study framework** | Skill protocol, `study/manifest.json`, `generate` jobs, validate/retry | 1 (PR #36) | On `main` |
| **Flashcards** | Skill + mode UI + refresh + local progress | 2 (PR #37) | On `main` |
| **Quiz** | Skill + mode UI + refresh | 3 (PR #39) | On `main` |
| **Memory** | Local vectors + semantic search in the existing search slot | 4 (PR #38) | On `main` |
| **Graph** | Concepts, cross-document edges, graph-lite UI | 5 (PR #40) | On `main` |
| **Diagrams** | Figure concepts merged into the graph | 6 (PR #41) | On `main` |
| **Citations** | Local verification that claims appear in cited digests | 7 (PR #41) | On `main` |
| **Closeout** | Grade buttons, quiz session answers, heading scroll, living docs, Mac E2E | 8 (`v0.2.2`) | Study loop and Notes leftovers are on `main` (`v0.2.3`). Mac batch still open. Ledger: [implementation checklist](../../../implementation-checklist.md). |

### Out of Version 3

- Chat / tutor (Version 4). v4 reads memory and graph. It does not create them.
- Multiple AI providers
- Scheduler (folder watch covers the ingest case)
- Cloud sync (Version 5)
- Anki export, pretty graph canvas, remote vector DBs
- Make-card-from-selection (shell spec: later refinement)

Issue #42’s Notes items (links, tables, reserved-root names) are implemented and locally tested. Recorded scroll on a Mac stays in the Version 3 batch. Chat, Anki, extra providers, and a pretty graph canvas stay out. Version 4 does not start until that Mac batch is recorded and `v0.3.0` is tagged.

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

**Tags.** Waves 1–7 were not given their own tags. They shipped inside `v0.2.2`. `v0.2.3` is tagged. The next product tag is `v0.3.0` after a clean Mac batch.

## Throughput checkpoint

```
Wave 0 (shell) shipped as v0.2.1
        │
        ▼
Waves 1–8 shipped as v0.2.2
        │
        ▼
Notes leftovers and Mac-batch fixes shipped as v0.2.3
        │
        ▼
One clean Mac batch of v0.2.3 (mac-e2e.md) ──▶ tag v0.3.0
        │
        ▼
Version 4 (#20 chat) ships as v0.3.1, v0.3.2, … until v0.4.0
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
8. [wave-8-closeout](wave-8-closeout.md). Grade, session answers, heading scroll, docs. Mac batch: [mac-e2e.md](mac-e2e.md). Notes leftovers: [2026-09-12-v3-notes-gate.md](../2026-09-12-v3-notes-gate.md) ([#42](https://github.com/MrF1ow/Arbor/issues/42))

## Release map

| Tag | Wave | User-visible |
|-----|------|----------------|
| `v0.2.1` | 0 | Desktop shell |
| `v0.2.2` | 1–8 | Generate, flashcards, quiz, semantic search, graph, figures, citation badges, grade buttons, stable quiz scores, heading scroll |
| `v0.2.3` | fixes | Issue #57 fixes, Notes links/tables/reserved names, path confinement and CSP. Current release. |
| **`v0.3.0`** | **Mac batch of `v0.2.3`** | **Version 3 complete** |

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

- [x] CHANGELOG 0.2.1 notes (Wave 0, on `main`)
- [x] README shell description (Wave 0, on `main`)
- [x] `desktop/README.md` update (Wave 0, on `main`)
- [x] Wave detail docs (this folder)
- [x] README / PROJECT.md / desktop README match waves 1–8 (package 0.2.2)
- [x] Living docs and program status match `v0.2.3`
- [ ] Mac E2E checklist run recorded in [mac-e2e.md](mac-e2e.md)

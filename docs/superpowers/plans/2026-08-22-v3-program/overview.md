# Arbor Version 3 program

> **Goal:** Ship a study app a student would download, with local memory and a concept graph an AI can query, without breaking the v2 ingest loop.

**Versioning:** Product Version 3 is built as package **`v2.x`**. `v2.1.0` was the first step after Version 2. Later waves are `v2.2.0`, `v2.3.0`, … Tag **`v3.0.0` only when every required feature below is done.** Never publish `3.1.0` or `3.2.0` as package versions. See [PROJECT.md Version numbering](../../../../PROJECT.md#version-numbering) and [`.cursor/rules/arbor-versioning.mdc`](../../../../.cursor/rules/arbor-versioning.mdc).

**Format contract:** [`docs/superpowers/specs/2026-08-22-v3-study-artifacts-format.md`](../../specs/2026-08-22-v3-study-artifacts-format.md)

**Knowledge layer:** [`docs/superpowers/specs/2026-08-23-v3-knowledge-layer-design.md`](../../specs/2026-08-23-v3-knowledge-layer-design.md)

**Shell design:** [`docs/superpowers/specs/2026-08-22-v3-desktop-shell-design.md`](../../specs/2026-08-22-v3-desktop-shell-design.md)

## Context

- **2.0.0** shipped automation (jobs, FTS, watch, OCR, Word) on the v1 UI.
- **2.1.0** shipped the desktop shell (Wave 0). Version 3 is **in progress**.
- **`v3.0.0` is reserved** for the full milestone. A shell plus placeholders is not a product someone keeps.
- Flashcards, quiz, embeddings, graph, diagrams, and citations have **no worker code yet**.

## Scope

Version 3 is the first Arbor a student would download **and** the substrate Version 4 (tutor) will query. That means a study loop, retrieval memory, a concept graph, and grounding. Deferring the graph or embeddings until chat exists would make the tutor reread the whole library on every turn.

### In Version 3 (required for `v3.0.0`)

| Track | Deliverable | Wave |
|-------|-------------|------|
| **Shell** | Sage/cream UI, course browser, digest preview, jobs/settings | 0 (`v2.1.0`, shipped) |
| **Study framework** | Skill protocol, `study/manifest.json`, `generate` jobs, validate/retry | 1 (`v2.2.0`) |
| **Flashcards** | Skill + mode UI + refresh + local progress | 2 (`v2.3.0`) |
| **Quiz** | Skill + mode UI + refresh | 3 (`v2.4.0`) |
| **Memory** | Local vectors + semantic search in the existing search slot | 4 (`v2.5.0`) |
| **Graph** | Concepts, cross-document edges, graph-lite UI | 5 (`v2.6.0`) |
| **Diagrams** | Figure concepts merged into the graph | 6 (`v2.7.0`) |
| **Citations** | Local verification that claims appear in cited digests | 7 (`v2.8.0`) |

### Out of Version 3

- Chat / tutor (Version 4). v4 reads memory and graph. It does not create them.
- Multiple AI providers
- Scheduler (folder watch covers the ingest case)
- Cloud sync (Version 5)
- Anki export, pretty graph canvas, remote vector DBs

## Locked decisions

These are not spikes. Implementers follow them.

**When are study artifacts created?** After ingest, as separate jobs. Digests stay the source of truth. Optional `auto_generate.<skill>` after a successful Update (default `false`).

**How does Codex return JSON?** One skill, one `provider.run`, one file. Prompt says JSON only. Pydantic parse + up to 2 retries (3 attempts). `ProviderResult.markdown` is the raw text payload. Skills call `json.loads` on it. `FakeProvider` already returns that field. Tests pass a JSON string as `markdown`. Do not add a second provider type.

**Retries.** New helper on the skill path (`skills/base.py`). The digest pipeline does **not** retry today (`pipeline.py` raises on `DigestError`). Do not pretend to copy a loop that does not exist. Leave digest behavior unchanged.

**Card / question ids.** Worker computes `id` as a short hash of normalized `front` (or quiz prompt) plus `source.digest`. Model-supplied ids are ignored. Progress in `.arbor/progress/` keys off that id. Unchanged cards keep progress across refresh.

**Per-course vs per-digest.** One generate call per course, concatenating digests with headings. If combined text exceeds the skill’s character budget, split per digest, merge, and drop duplicate fronts.

**Jobs.** Reuse `JobCoordinator` mutex. Add `JobTrigger::Study`. Plan JSON is `{ "course", "skill", "force" }`. Error copy becomes “A job is already running for {root}” (today it says “An update is already running”).

**Git.** Successful generate commits `study/manifest.json` and the artifact file. Progress, vectors, and `arbor.db` stay local. Extend `ensure_gitignored` for `.arbor/progress/` and `.arbor/vectors.sqlite`.

**pydantic.** Not in `python/pyproject.toml` today. Wave 1 adds it.

## Throughput checkpoint

```
Wave 0 (shell) shipped
        │
        ▼
Wave 1 (study framework) ──must finish──▶ Wave 2 (flashcards)
        │                                 Wave 3 (quiz)
        │                                 Wave 4 (memory)
        │                                 Wave 5 (graph)
        ▼
Wave 5 (graph) ──must finish──▶ Wave 6 (diagrams)
                                Wave 7 (citations)
        │
        ▼
     v3.0.0
```

Waves 2–5 can run in parallel after Wave 1. Waves 6 and 7 write into the graph, so they wait for Wave 5. Wave 4 does not need flashcards.

## Waves

0. [mac-e2e](mac-e2e.md) — Mac ingest checklist on the new shell (open from Wave 0)
1. [wave-1-study-framework](wave-1-study-framework.md) — skill protocol, `generate`, jobs, retries
2. [wave-2-flashcards](wave-2-flashcards.md) — deck skill + UI
3. [wave-3-quiz](wave-3-quiz.md) — quiz skill + UI
4. [wave-4-memory](wave-4-memory.md) — embeddings + semantic search
5. [wave-5-graph](wave-5-graph.md) — concepts, links, graph-lite
6. [wave-6-diagrams](wave-6-diagrams.md) — figures into the graph
7. [wave-7-citations](wave-7-citations.md) — local citation checks

## Release map

| Tag | Wave | User-visible |
|-----|------|----------------|
| `v2.1.0` | 0 | Desktop shell |
| `v2.2.0` | 1 | Generate empty states, study jobs in the log |
| `v2.3.0` | 2 | Flashcards work + refresh |
| `v2.4.0` | 3 | Quiz works + refresh |
| `v2.5.0` | 4 | Semantic search |
| `v2.6.0` | 5 | Concepts + links in Notes |
| `v2.7.0` | 6 | Figures appear as concepts |
| `v2.8.0` | 7 | Citation badges |
| **`v3.0.0`** | **all** | **Version 3 complete** |

## Verification (every wave)

```bash
cd python && uv run pytest -q
cd desktop/src-tauri && cargo test
cd desktop && npm run build
```

Manual on Mac. Pick Knowledge folder → Update → Confirm → commit → search. Then exercise the wave’s mode (Generate / flip / quiz / semantic toggle / concept chip). v2 ingest must still pass.

No `control-ui` skill is wired for this Tauri app. Runtime checks are pytest, cargo test, `npm run build`, and the Mac checklist in [mac-e2e.md](mac-e2e.md).

## Constraints (unchanged)

- Markdown digests = source of truth
- SQLite / vectors / progress = derived or local
- Codex CLI external
- Rust orchestrates, Python thinks
- One job at a time

## Open spike (Wave 4 only)

**Embedding backend.** Local ONNX vs a small Python model vs whatever Codex can offer. Offline and private wins for a downloaded Mac app. Tests never wait on that choice (`FakeEmbedder`). First PR of Wave 4 picks the backend and records it in the knowledge-layer spec.

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
- [ ] Mac E2E checklist run recorded in [mac-e2e.md](mac-e2e.md)

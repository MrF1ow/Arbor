# Arbor V1 Design

**Date:** 2026-08-02  
**Status:** Historical. Living product is package **0.2.0** (tag `v0.2.0`), still PROJECT.md Version 1.  
**Product name:** Arbor  
**Category:** Academic Knowledge System (see `PROJECT.md`)  
**Source vision:** `PROJECT.md` (narrowed for V1)

> Do not treat this file as the current layout. Course folders, dated `digests/`, `course.md`, and `arbor-course.json` replaced per-lecture `lecture.md` and `metadata.json`. See [`2026-08-12-course-centric-knowledge-design.md`](2026-08-12-course-centric-knowledge-design.md), [`2026-08-12-page-fingerprinting-design.md`](2026-08-12-page-fingerprinting-design.md), and the root [`README.md`](../../../README.md).

## Overview

Arbor is a local-first desktop app that turns lecture materials into structured, searchable study digests. V1 proves the core loop for a graduate student on macOS or Linux:

1. Choose a Knowledge library folder (git-tracked).
2. Drop lecture sources into course/lecture folders she creates.
3. Hit **Update Knowledge**.
4. Get `lecture.md` + `metadata.json` per lecture, committed to git.

AI runs only through an already-authenticated **Codex CLI** subscription. There is no API-key path. A thin CLI-provider interface exists so later iterations can add Claude Code CLI, Grok CLI, Cursor CLI, and similar subscription CLIs without redesigning the app.

## Goals

- Make the smallest useful product: PDF/PPTX in → structured study notes out.
- Keep all knowledge local; markdown is the source of truth for digests.
- Use git as the processed-state machine (dirty sources → work; commit → done).
- Ship a thin Tauri shell that can grow into the full UI later.
- Stay Mac + Linux only.

## Non-goals (V1)

- Windows
- API keys or cloud AI HTTP APIs
- Full course browser / markdown preview UI
- Flashcards, quizzes, knowledge graph, chat-over-library
- Folder watching / scheduler / SQLite
- Other CLI providers (interface only; Codex implemented)
- Per-pipeline-step model overrides (settings shaped for later; V1 has one model per Update)

## Constraints

| Constraint | Detail |
|------------|--------|
| Platforms | macOS and Linux only |
| AI access | Codex CLI must already be installed and authenticated |
| Billing model | Student subscription pools via CLIs — not API rate-limited keys |
| Data | Local filesystem; Knowledge root is a git repo of sources + digests |
| Extensibility | Provider interface for other *CLI* backends in later iterations |

## Architecture

**Approach:** Thin Tauri + Python pipeline (Rust orchestrates lightly; Python does intelligent work).

```
Tauri UI (minimal)
  → Knowledge root, format guidance, model dropdown, Update, progress/log
Rust (thin orchestrator)
  → settings persistence, spawn/supervise Python worker, relay status/cancel
Python worker
  → auth gate → git scan → format-specific prepare → Codex provider → write → commit
```

Rust does not contain AI logic. Python owns parsing/rendering, provider calls, stage validation, and git commits for digests.

### High-level components

| Component | Responsibility |
|-----------|----------------|
| Tauri UI | Minimal controls and progress; no deep domain logic |
| Rust orchestrator | Window lifecycle, settings, worker process, IPC |
| Python worker | Pipeline stages, resume, git commit of successes |
| `CliProvider` interface | Abstract subscription CLI backends |
| `CodexCliProvider` | Only V1 implementation |
| Knowledge git repo | Sources + digests; history = processed record |

## Knowledge library layout

User creates course and lecture folders. One lecture folder contains one primary source plus digest artifacts:

```
Knowledge/                          # git repo root
  .git/
  .gitignore                        # includes _arbor_cache/
  Biology/
    Lecture 01 - Intro/
      source.pdf                    # or slides.pptx
      lecture.md
      metadata.json
    Lecture 02 - Cells/
      slides.pptx
      lecture.md
      metadata.json
  Nursing/
    ...
  _arbor_cache/                     # gitignored render/temp artifacts
```

**Git tracks sources and digests together** so history remains even if a folder is later deleted. Binary size growth is an accepted tradeoff.

### Git-as-state rules

1. On Update (after auth gate), find **new or modified source files only** (`.pdf` / `.pptx`) relative to the last commit / working tree. Edits to `lecture.md` / `metadata.json` alone do **not** queue reprocessing.
2. Process each dirty source through staged pipeline with validation.
3. On successful Write only: overwrite `lecture.md` and `metadata.json` beside the source. Failed stages write no success artifacts to commit.
4. **One git commit per successful Update batch**, including only lectures that passed Write (their sources if new/modified, plus digests). Message pattern: `digest: <summary of processed paths>`.
5. Unchanged, already-committed sources → **skip**.
6. Failed lectures stay eligible for retry (source remains dirty or incomplete relative to a successful digest commit).
7. Deleted paths: no reprocess in V1; history remains in git.

### metadata.json (minimum fields)

- `source_filename`
- `source_type`: `pdf` | `pptx`
- `source_hash`
- `processed_at`
- `provider`: `codex_cli`
- `model_id`
- `processing_path`: `pdf_images` | `pptx_text` | `pptx_images_fallback`
- `status`: `ok` (failed runs do not write a successful metadata commit)

## Ingestion and format guidance

### UI note (always visible)

- If the material has **handwritten / GoodNotes** markup → export and upload as **PDF**.
- If it is clean digital slides with **no ink** → **PPTX** is fine.
- File format determines the processing path.

### Format-specific processing

| Source | Path |
|--------|------|
| **PDF** | Render pages to images → Codex with image attachments (`--image` or equivalent) + digest prompt |
| **PPTX** | Extract slide text/structure locally → Codex text prompt. If extract is empty or too thin → render-to-images fallback (same as PDF path) |

Raw binary PPTX/PDF is **not** fed as the sole AI input. Annotated content requires page images for Codex’s multimodal image support. Native PDF understanding in Codex is not relied upon.

Temp page images and extract artifacts live under `_arbor_cache/` (gitignored), keyed by source hash for resume.

## Update pipeline

### Hard auth gate

**Before any other work:**

1. Verify Codex CLI is on `PATH`.
2. Verify the CLI is authenticated (subscription session).
3. On failure → stop immediately. No scan, no render, no git. UI shows error + link to Codex setup docs.

### Stages (per lecture)

Each stage validates outputs before the next. Empty or invalid outputs fail the stage.

1. **Discover** — Source exists, non-empty, `.pdf` or `.pptx`.
2. **Prepare** — PDF→images or PPTX→text (or image fallback). Artifacts must be non-empty (page count ≥ 1, or extract length above thinness threshold).
3. **Generate** — Call `CliProvider.run(...)` with selected `model_id` and digest prompt (+ images when applicable). Result must be non-empty and pass a basic structure check (e.g. required markdown sections present).
4. **Write** — Persist `lecture.md` and `metadata.json`; both must exist and be non-empty on disk.
5. **Commit** (batch) — After the run, commit all lectures that passed Write in one commit.

### Resume

- Cache Prepare outputs by `source_hash`.
- If Generate or Write fails, a later Update reuses Prepare artifacts when the source hash is unchanged.
- Incomplete lectures are never committed.
- Cancel stops at the next stage boundary; in-flight lecture is not committed.

### Digest content (Generate target)

Structured study notes markdown, including at least:

- Title
- Overview
- Key concepts
- Important details
- Questions to review

Plus `metadata.json` as specified above.

### Concurrency

V1 processes lectures **sequentially** for simpler progress, cancellation, and Codex quota behavior.

### Model selection

- V1 UI: **one model dropdown** for the whole Update run; value persisted as default in app settings.
- Dropdown populated via `CodexCliProvider.list_models()`.
- Selected `model_id` is passed into Codex CLI arguments and recorded in metadata.
- Later: optional advanced per-step model overrides without changing the provider interface shape (interface may accept a step→model map later; V1 passes a single model).

## CLI provider interface

Python-side abstraction (names illustrative):

```text
CliProvider
  name: str
  is_available() -> bool          # binary present + authenticated
  list_models() -> list[Model]
  run(request: ProviderRequest) -> ProviderResult
```

`ProviderRequest` includes: prompt, `model_id`, optional image paths, working directory / lecture context.  
`ProviderResult` includes: markdown body (and any structured fields the worker needs).

**V1 implements only `CodexCliProvider`.**  
Later implementations (same interface, still no API keys): Claude Code CLI, Grok CLI, Cursor CLI, etc.

The rest of the worker never branches on vendor-specific APIs—only on provider capabilities exposed by the interface (e.g. image support).

## Minimal Tauri UI

Single window:

| Element | Behavior |
|---------|----------|
| Knowledge root | Path + “Choose folder…”; `git init` if selecting a non-repo empty/new library |
| Format guidance | Always-visible PDF vs PPTX note |
| Model | Dropdown; persisted default |
| Update Knowledge | Primary action; disabled when auth gate fails |
| Progress / log | Per-file stage lines and errors |
| Open folder | Reveal Knowledge root in system file manager |
| Codex status | OK / not authenticated; docs link when failed |

No course browser, preview pane, or separate settings screen in V1 beyond folder + model on this screen.

## Error handling summary

| Condition | Behavior |
|-----------|----------|
| CLI missing / unauthenticated | Block all work; show docs link |
| Unsupported extension | Ignore |
| Empty source | Fail Discover; retry later |
| Empty Prepare artifacts | Fail Prepare; no Generate |
| Empty/invalid Codex output | Fail Generate; keep Prepare cache for resume |
| Write failure | Fail Write; no commit for that lecture |
| Mixed success/failure in batch | Commit successes only |
| Clean working tree after auth | “Nothing to process” |
| Cancel | Finish current stage boundary; no partial lecture commit |

## Testing

### Automated (no live Codex)

- Auth gate short-circuits pipeline when unavailable.
- Git dirty detection; clean skip; batch commit of successes only; failures excluded.
- Stage validators reject empty inputs/outputs.
- Resume reuses Prepare cache when `source_hash` unchanged.
- Format routing: PDF → images; PPTX → text; thin PPTX → image fallback.
- Provider receives selected `model_id`.

### Manual (real Codex on Mac or Linux)

- Unauthenticated state blocks Update and shows docs link.
- Annotated-style PDF and clean PPTX each produce digest + metadata + commit.
- Model dropdown changes CLI model argument.
- Cancel mid-run leaves no commit for the incomplete lecture.

## Later iterations (explicitly out of V1)

Aligned with `PROJECT.md` roadmap, but ordered after V1 is useful:

- Full desktop UI (browse courses, preview digests)
- Per-step model overrides
- Additional CLI providers (Claude Code, Grok, Cursor, …)
- Flashcards / quizzes / search / SQLite
- Folder watching and scheduling
- Chat over the knowledge base

## Design decisions log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Provider strategy | CLI subscriptions via interface; Codex first | Students pay for CLIs, not API keys |
| V1 surface | Thin Tauri, not CLI-only | Proves product path; grows to full UI |
| Architecture | Thin Rust + Python worker | Fast to ship; matches long-term split |
| Organization | User-created course/lecture folders | Deterministic; matches student mental model |
| Update scope | Whole Knowledge root | Fits one-button UI |
| Digests | Structured study notes + metadata | Useful for grad study |
| Git | Sources + digests; commit = processed | Durable state even after deletes |
| Annotated slides | PDF → page images → Codex `--image` | Text extract misses GoodNotes ink; raw PPTX/PDF unreliable |
| Clean PPTX | Text extract first | Faster; fallback to images if thin |
| Models | One per Update in V1 | Minimal UI; interface ready for per-step later |
| Auth | First check; fail closed | Never burn work or confuse empty runs |

## Open implementation notes

- Exact Codex CLI flags (`exec` / quiet / image / model) to be confirmed against current Codex CLI docs during implementation.
- PPTX “thin extract” threshold to be chosen empirically (e.g. min characters or min non-empty slides).
- Lecture folder creation: V1 assumes she places each source in its lecture folder; auto-wrapping loose files in a course directory can be a small convenience if needed during implementation without changing this design.

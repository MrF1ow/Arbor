# Arbor Version 2: automation and discoverability

> **Playbook:** poteto-mode orchestrate + multi-phase plan. Waves 2–4 in PR #26. Wave 1 merged in #25. Packaged as **2.0.0**.

**Predicate:** every Update is a tracked single-flight job with persisted history; the knowledge library is searchable via SQLite FTS; folder watching can enqueue updates; Word and OCR extend prepare; desktop notifications fire on job completion. No scheduler, no multi-provider, no course browser redesign in this program.

## Context

1.0.0 shipped the Version 1 loop. Manual Update, Codex CLI only, markdown + git as source of truth. V2 adds automation and findability without a visual redesign pass.

## Scope

**In**

- Job registry in `<Knowledge>/.arbor/arbor.db` with single-flight mutex
- Persisted JSONL events per job and minimal job history UI
- SQLite FTS index over digests and course metadata
- Search box in the existing single screen
- Folder watching with debounced auto-plan and opt-in auto-run
- Desktop notifications on job terminal states
- Word (`.docx`) and OCR paths in the Python prepare layer

**Out**

- Scheduler
- Multiple AI providers
- Course browser, markdown preview, polish (V3/V4)
- In-app chat (#20, Version 4)
- Bundling Codex

## Throughput checkpoint

```
Wave 1 (job spine) ──must finish──▶ Wave 3 (watch + notify)
         │
         └──also gates──▶ Wave 2 (index + search)

Wave 4 (Word, OCR)     parallel after Wave 1
```

## Waves

1. [wave-1-job-spine](wave-1-job-spine.md) — SQLite jobs, single-flight, history UI
2. [wave-2-index-search](wave-2-index-search.md) — FTS indexer, reindex command, search UI
3. [wave-3-watch-notify](wave-3-watch-notify.md) — notify crate, auto-update settings, notifications
4. [wave-4-source-types](wave-4-source-types.md) — Word and OCR prepare paths

## Verification

```bash
cd python && uv run pytest -q
cd desktop/src-tauri && cargo test
cd desktop && npm run build
```

## Constraints

- Markdown remains source of truth; SQLite is derived and rebuildable
- Rust orchestrates; Python performs intelligent work
- Codex CLI stays external
- Auto-update defaults to notify + review; silent auto-run is opt-in

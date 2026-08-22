# Changelog

Package version for the worker, desktop, and Tauri app. Product milestone is [PROJECT.md](PROJECT.md) Version 2 automation (see [V2 program plan](docs/superpowers/plans/2026-08-19-v2-automation/overview.md)).

## Unreleased

- Folder watch stays on when `<Knowledge>/.arbor/settings.json` is missing. Desktop `KnowledgeSettings::default()` now matches the worker and Wave 3 spec (`watch_enabled: true`).

### Wave 1 (merged in #25)

- Job spine. SQLite at `<Knowledge>/.arbor/arbor.db`, single-flight updates, persisted JSONL events, job history UI.

### Wave 2–4 (#26)

- SQLite FTS5 search index with `arbor-worker reindex` and search box in the desktop UI.
- Folder watching with debounced auto-plan, optional `auto_update` in `.arbor/settings.json`, desktop notifications on job completion.
- Word (`.docx`) prepare path and optional Tesseract OCR fallback for low-text PDF pages.

## 1.0.0 — 2026-08-19

Git tag: [`v1.0.0`](https://github.com/MrF1ow/Arbor/releases/tag/v1.0.0). Merge: [PR #24](https://github.com/MrF1ow/Arbor/pull/24).

- First downloadable macOS `.dmg`. GitHub Actions `macos-dmg` bundles `arbor-worker` as a Tauri sidecar via PyInstaller. Codex CLI stays a separate install. Signing and notarization stay off.
- Treat leftover pages as pending after a partial ingest. Empty fingerprint slots keep the source in the plan with those ranges suggested.
- A failed two-digest course rollup still saves `arbor-course.json`, digest files, and a link-only `course.md`, then commits so the next Update does not duplicate work.
- Course rollup prompts include the same source and formatting rules as lecture digests.
- Confirm re-checks Codex auth. `start_update` also runs `check-auth` before spawning the worker.

Not in this release: notarized Mac builds, in-app chat (#20), PROJECT.md Version 2.

## 0.2.0 — 2026-08-19

Git tag: [`v0.2.0`](https://github.com/MrF1ow/Arbor/releases/tag/v0.2.0). Merge: [PR #22](https://github.com/MrF1ow/Arbor/pull/22).

- Confirm page ranges in the review panel (`151-300`, `40-55, 120-122`). Plan JSON is `{ selections: [{ path, ranges }] }`.
- Persist per-page fingerprints in `arbor-course.json` (`version` 2 `sources`). Suggest dirty ranges on the next Update.
- Wrap new digests in `<!-- arbor-pages:X-Y -->`. Overlapping coverage patches that block in place instead of adding a second digest file.
- One digest writes a short local `course.md` index. Two or more still roll up with Codex.
- Force PPTX image fallback when the confirmed range is not the whole deck.
- Resolve Codex CLI on a Finder-like PATH and time out hung `login status`. Single-flight desktop auth refresh.
- Reject LaTeX tokens and require portable Markdown in lecture digests.
- `FakeProvider` returns markdown unchanged. Tests that need markers wrap in the test helper.

Not in this release: notarized Mac builds, in-app chat (#20), PROJECT.md Version 2.

## 0.1.0

First public worker and desktop loop: course folders, dated digests, chunked large PDFs, Codex CLI only.

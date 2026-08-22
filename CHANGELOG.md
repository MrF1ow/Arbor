# Changelog

Package version for the worker, desktop, and Tauri app. Product milestone is [PROJECT.md](PROJECT.md) Version 2 (see [V2 program plan](docs/superpowers/plans/2026-08-19-v2-automation/overview.md)).

## Unreleased

## 2.0.0 — 2026-08-22

Git tag: `v2.0.0`. Product milestone: [PROJECT.md](PROJECT.md) Version 2.

Version 1 loop is unchanged: pick a Knowledge folder, review page ranges, Codex writes digests, git commits. This release adds automation and findability on that same screen.

- Job spine. SQLite at `<Knowledge>/.arbor/arbor.db`, one update at a time, persisted JSONL events, Recent runs in the desktop UI. (#25)
- SQLite FTS5 search over digests. `arbor-worker reindex --root` rebuilds the index. Search box in the app. (#26)
- Folder watch via `notify`. Default is watch then review, not silent ingest. Missing `.arbor/settings.json` still leaves `watch_enabled` on. (#26, #32)
- Optional `"auto_update": true` in `.arbor/settings.json` starts the job without Confirm. Those jobs record `trigger_kind` `watch`.
- Desktop notification when a job succeeds, fails, or is cancelled.
- Word (`.docx`) prepare path. Optional Tesseract OCR for low-text PDF pages.
- macOS `.dmg` from GitHub Actions. `arbor-worker` is bundled. Codex CLI stays a separate install. Signing and notarization stay off.

Mac validation from source: full PDF ingest and commit, version-2 fingerprints, digest markers, course rollup, job history, search, reindex, and folder-watch review after shortening a PDF.

Not in this release: notarized Mac builds, in-app chat, flashcards, a visual redesign. The UI is still the Version 1 single-column shell.

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

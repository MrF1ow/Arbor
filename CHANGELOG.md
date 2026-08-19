# Changelog

Package version for the worker, desktop, and Tauri app. Product milestone stays [PROJECT.md](PROJECT.md) Version 1 until Version 2 work (watchers, search, extra providers) starts.

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

Not in this release: macOS packaging (#4), in-app chat (#20), PROJECT.md Version 2.

## 0.1.0

First public worker and desktop loop: course folders, dated digests, chunked large PDFs, Codex CLI only.

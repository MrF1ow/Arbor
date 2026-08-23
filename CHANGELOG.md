# Changelog

Package version for the worker, desktop, and Tauri app. See [Version numbering](PROJECT.md#version-numbering) in `PROJECT.md`.

**Version 2** is complete at `v2.0.0` (tagged). **Version 3** is in progress; incremental releases use `v2.1.0`, `v2.2.0`, … until `v3.0.0` when the full v3 milestone ships. **Current tag:** `v2.1.0`.

## Unreleased

Quiz (Wave 3, toward package `v2.4.0`).

- `arbor-worker generate --skill quiz` writes `study/quiz.json`, assigns `q_` ids from normalized prompt plus digest, and commits `study: {course} quiz`. Concatenated digests over 100k characters split per digest, then merge and drop duplicate prompts. Unchanged digest hashes still emit `skill_stale_skipped`.
- `.arbor/settings.json` reads `auto_generate.quiz` (default false). Desktop Generate / Refresh run Codex when a model is selected. Progress lives in `.arbor/progress/<course>.quiz.json` and keeps counts for stable ids.
- Quiz tab: empty Generate, one question with four choices, Submit then explanation, next / prev, source chip to Notes, stale badge. After Update, optional auto-generate queues behind flashcards through the existing job mutex.

Memory and semantic search (Wave 4, toward package `v2.5.0`).

- `arbor-worker embed` chunks digests by heading, builds local 256-dimension hashed n-gram vectors, and replaces stale rows in the gitignored `.arbor/vectors.sqlite` store.
- `arbor-worker embed-search` runs brute-force cosine search and returns digest-shaped search hits without a network service.
- The desktop search overlay keeps full-text search as the default and adds a Semantic toggle. An optional "Embed after Update" setting queues embedding through the existing job mutex.

Flashcards (Wave 2, toward package `v2.3.0`).

- `arbor-worker generate --skill flashcards` writes `study/flashcards.json`, assigns `fc_` ids from normalized front plus digest, and commits `study: {course} flashcards`. Concatenated digests over 100k characters split per digest, then merge and drop duplicate fronts. Unchanged digest hashes still emit `skill_stale_skipped`.
- `.arbor/settings.json` reads `auto_generate.flashcards` (default false). Desktop Generate / Refresh run Codex when a model is selected. Progress lives in `.arbor/progress/<course>.flashcards.json` and keeps counts for stable ids.
- Flashcards tab: empty Generate, flip / next / prev / shuffle, source chip to Notes, stale badge. Quiz Generate stays disabled.

Study framework (Wave 1, toward package `v2.2.0`).

- `arbor-worker generate --root --course --skill fixture` writes `study/fixture.json` and `study/manifest.json`, then commits `study: {course} fixture`. Unchanged digests emit `skill_stale_skipped`. Invalid JSON retries twice and leaves a prior artifact untouched.
- `.gitignore` gains `.arbor/progress/` and `.arbor/vectors.sqlite` on generate.
- Desktop `start_study_job` reuses the job mutex with copy "A job is already running for {root}". Quiz generation remains disabled.

## 2.1.0 — 2026-08-22

Git tag: `v2.1.0`. **Product:** Version 3 in progress (shell only). Not `v3.0.0` — that tag is reserved for full Version 3 completion.

Version 2 ingest, automation, and search are unchanged. This release replaces the single-column debug UI with a student-facing desktop shell.

- Desktop shell: sage and cream palette, 1100×760 window (min 900×640), sidebar with course library, Jobs and Settings at the bottom.
- Course workspace: Notes / Flashcards / Quiz mode tabs. Notes mode browses `course.md` and digest previews in-app (serif reading pane, page-marker chips).
- Flashcards and Quiz tabs show a Coming soon empty state until later `v2.x` releases.
- Bottom inspector (collapsed by default): Update knowledge, review table, and job log. No always-visible terminal on the home screen.
- In-app Settings: watch folder, auto-run, delete-after-digest, model picker, and reindex. Writes `.arbor/settings.json`.
- Search overlay in the course header. Hits open Notes and navigate to the matching digest.
- New Tauri commands: `list_courses`, `list_digests`, `read_markdown`, `save_knowledge_settings`.
- Dark mode follows `prefers-color-scheme` with the same hierarchy as light.
- Reference mockup: `docs/mockups/v3-shell.html`.

Not in this release: flashcard or quiz generation, embeddings, semantic search, chat. **Not a Version 3 completion release.**

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

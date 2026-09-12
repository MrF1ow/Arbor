# Implementation checklist

Living tracker for **implemented / locally tested / Mac-batch tested**. Capability intent and GitHub issue text live in [`PROJECT.md`](../PROJECT.md). This file is the gate.

**How to use**

- Check **Implemented** when the code is on `main`.
- Check **Local/VM** when pytest, cargo, and npm tests for that row are green (Linux agents and CI).
- Check **Mac batch** only when a recorded MacBook run covered that row. One batch covers many rows. Do not Mac-test every PR.
- **Blockers from Mac runs** at the bottom catch E2E findings. They block the current version’s tag. They do not start the next version.

**Current era:** Version 3. **Next version (Version 4) is blocked** until the Version 3 Mac batch is recorded.

**Current package:** `2.2.0` (untagged; latest GitHub Release is `v2.1.0`).

| Marker | Meaning |
|--------|---------|
| [x] | Done |
| [ ] | Not done |
| n/a | Not required for this row |

---

## Gates

| From | To | May continue when |
|------|----|-------------------|
| Version 1 | Version 2 | Version 1 implemented + locally tested. Mac proof for packaging may ride a later batch. **Passed** (`v2.0.0` tagged). |
| Version 2 | Version 3 shell | Version 2 features implemented + locally tested. **Passed** (`v2.0.0` tagged; shell is `v2.1.0`). Leftover Version 2 Mac boxes ride the Version 3 batch. |
| Version 3 work | **`v3.0.0` tag** | All Version 3 required rows implemented + locally tested **and** one Version 3 Mac batch recorded in [mac-e2e.md](superpowers/plans/2026-08-22-v3-program/mac-e2e.md). **Not passed.** |
| Version 3 | Version 4 | `v3.0.0` tagged. **Blocked.** Do not implement issue #20 until then. |
| Version 4 | Version 5 | `v4.0.0` tagged after a Version 4 Mac batch. |

Local commands (every change):

```bash
cd python && uv run pytest -q
cd desktop/src-tauri && cargo test
cd desktop && npm test && npm run build
```

Mac batch script for the current era: [mac-e2e.md](superpowers/plans/2026-08-22-v3-program/mac-e2e.md). Next-phase engineering: [2026-09-12-v3-notes-gate.md](superpowers/plans/2026-09-12-v3-notes-gate.md).

---

## Version 1 — smallest useful app

Shipped as part of `v2.0.0`. GitHub issues #3, #4, #19, #21.

| Item | Issue | Implemented | Local/VM | Mac batch | Notes |
|------|-------|-------------|----------|-----------|-------|
| Desktop app, Update, PDF/PPTX, course folders, dated digests, git commit | — | [x] | [x] | [x] | Clin Med 2 run on #30 (2026-08-22) |
| Digest prompt source rules + reject `\(`, `\[`, `\frac` on create/regenerate | [#3](https://github.com/MrF1ow/Arbor/issues/3) | [x] | [x] | [x] | Live run reported no LaTeX |
| `validate_digest` on **patch** splices | [#3](https://github.com/MrF1ow/Arbor/issues/3) follow-up | [ ] | [ ] | n/a until local | `_apply_patch` skips validation. Version 3 Notes-gate plan includes this. |
| Codex GUI PATH, 10s timeout, single-flight auth | [#19](https://github.com/MrF1ow/Arbor/issues/19) | [x] | [x] | [ ] | Homebrew paths added in 2.2.0; Finder proof is on the Version 3 Mac batch |
| Manifest v2, fingerprints, page markers, dirty ranges, in-place patch | [#21](https://github.com/MrF1ow/Arbor/issues/21) | [x] | [x] | [x] | Clin Med 2 |
| Single-digest `course.md` index (not a full copy) | [#21](https://github.com/MrF1ow/Arbor/issues/21) | [x] | [x] | [ ] | Index is written; **link rendering** is Version 3 Notes |
| DMG + bundled `arbor-worker` sidecar | [#4](https://github.com/MrF1ow/Arbor/issues/4) | [x] | [x] CI builds DMG | [ ] | Finder install without repo/`uv` is a Version 3 Mac box. Signing is not required. |

---

## Version 2 — automation

Shipped `v2.0.0`. Do not add features here. Leftover proof rides the Version 3 Mac batch (issue #30).

| Item | Issue | Implemented | Local/VM | Mac batch | Notes |
|------|-------|-------------|----------|-----------|-------|
| Job spine, single-flight, history | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [x] | Clin Med 2 job history |
| FTS search + reindex | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [x] | Search UI open-from-overlay still on Version 3 batch |
| Folder watch → review | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [x] | Verified after #32 |
| Optional `auto_update` | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [ ] | Optional on Mac batch |
| Desktop notification on job end | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | n/a Linux agent | [ ] | Required Mac box |
| Word `.docx` ingest | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [ ] | Required Mac box |
| OCR fallback (Tesseract) | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [ ] | Optional if Tesseract missing |

---

## Version 3 — study app (current)

Package `2.2.0` on `main`. **`v3.0.0` blocked** on remaining rows + Mac batch.

### Shipped (do not re-do)

| Item | Implemented | Local/VM | Mac batch |
|------|-------------|----------|-----------|
| Desktop shell (sidebar, Notes preview, jobs, settings) `v2.1.0` | [x] | [x] | [ ] |
| Study generate jobs, skill protocol, retries | [x] | [x] | [ ] |
| Flashcards generate / flip / Again / Wrong / Mastered | [x] | [x] | [ ] |
| Quiz generate / submit / session answers | [x] | [x] | [ ] |
| Source chips → heading scroll | [x] | [x] | [ ] |
| Local embeddings + semantic search | [x] | [x] | [ ] |
| Concepts, graph-lite, figure merge, citation badges | [x] | [x] | [ ] |
| Add class, add files, theme, hide `_arbor_cache`, H1 digest titles | [x] | [x] | [ ] |
| Nested/ordered lists, bold, italic, inline code in Notes | [x] | [x] | [ ] |

### Remaining — must finish before the Version 3 Mac batch

These are issue [#42](https://github.com/MrF1ow/Arbor/issues/42) acceptance criteria that did not land, plus the #3 patch-validation follow-up. Plan: [2026-09-12-v3-notes-gate.md](superpowers/plans/2026-09-12-v3-notes-gate.md).

| Item | Issue | Implemented | Local/VM | Mac batch |
|------|-------|-------------|----------|-----------|
| Markdown links render; `digests/*.md` opens that digest in Notes | [#42](https://github.com/MrF1ow/Arbor/issues/42) | [ ] | [ ] | [ ] |
| Markdown tables render as tables | [#42](https://github.com/MrF1ow/Arbor/issues/42) | [ ] | [ ] | [ ] |
| Closing `arbor-pages` markers stripped from the reading pane | [#42](https://github.com/MrF1ow/Arbor/issues/42) | [x] | [x] | [ ] |
| Shared reserved-dir policy (`_arbor_cache`, `.arbor`, `study`, `digests` at Knowledge root) | [#42](https://github.com/MrF1ow/Arbor/issues/42) | [ ] | [ ] | [ ] |
| Long digest scrolls end-to-end in the real Arbor window | [#42](https://github.com/MrF1ow/Arbor/issues/42) | CSS present | [x] CSS unit tests | [ ] |
| `validate_digest` on patch output | [#3](https://github.com/MrF1ow/Arbor/issues/3) | [ ] | [ ] | n/a |

### Version 3 Mac batch (once, after remaining rows are locally green)

Record date, macOS version, and commit or DMG in [mac-e2e.md](superpowers/plans/2026-08-22-v3-program/mac-e2e.md) and here.

| Box | Result |
|-----|--------|
| Ingest + commit + Notes preview + search + watch | [ ] |
| Flashcards grade, quiz session, semantic search, graph chip, citations | [ ] |
| `course.md` link opens digest; table visible; no closing page-marker text | [ ] |
| Notifications, Word ingest | [ ] |
| Finder DMG launch (no repo / `uv`) | [ ] |
| Optional auto-run / OCR | [ ] if available |

**Mac batch recorded:** _not yet_

After this table is filled, tag `v2.2.0` if not already tagged, then tag **`v3.0.0`**. Only then may Version 4 start.

---

## Version 4 — tutor (blocked)

Issue [#20](https://github.com/MrF1ow/Arbor/issues/20). Do not check these until Version 3 is closed.

| Item | Implemented | Local/VM | Mac batch |
|------|-------------|----------|-----------|
| Chat tab on selected Knowledge root + course | [ ] | [ ] | [ ] |
| Retrieve `course.md` / digests / page metadata before Codex | [ ] | [ ] | [ ] |
| Source-grounded answers; say when unsupported | [ ] | [ ] | [ ] |
| Clickable digest/page citations | [ ] | [ ] | [ ] |
| Per-course history; new/clear chat | [ ] | [ ] | [ ] |
| Read-only Knowledge unless user asks to generate | [ ] | [ ] | [ ] |
| Stream progress; auth/error states | [ ] | [ ] | [ ] |
| Ask / Explain / Quiz modes from course material only | [ ] | [ ] | [ ] |
| Behavioral Medicine cited-answer acceptance run (Mac batch) | [ ] | [ ] | [ ] |

Also Version 4 (not extra GitHub issues): review scheduling, weak-topic detection, study plans, make-card-from-selection, extra AI providers.

---

## Version 5 — collaboration (blocked)

No current GitHub issue. Cloud sync, shared libraries, marketplaces, permissions, remote workers. Starts after `v4.0.0`.

---

## Blockers from Mac runs

Add a row when a Mac batch finds a failure. Status starts as implemented-no / local-no. Fix locally. Retest on the **next** Mac batch, not a dedicated trip.

| Date | Version | Finding | Implemented | Local/VM | Next Mac batch |
|------|---------|---------|-------------|----------|----------------|
| _none yet_ | | | | | |

---

## Stale GitHub hygiene (does not block versions)

Operator can close when the checklist row is done. Code already matches the original AC:

- #3 (except patch-validation follow-up)
- #4 (except Finder proof on the Version 3 Mac batch; do not wait on notarization)
- #19
- #21
- PR [#31](https://github.com/MrF1ow/Arbor/pull/31) superseded by merged #32

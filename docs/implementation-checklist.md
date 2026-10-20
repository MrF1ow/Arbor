# Implementation checklist

Living tracker for **implemented / locally tested / live-run tested**. Capability intent and GitHub issue text live in [`PROJECT.md`](../PROJECT.md). Mac proof is optional. This file is the gate.

**How to use**

- Check **Implemented** when the code is on `main`.
- Check **Local/VM** when pytest, cargo, and npm tests for that row are green (Linux agents and CI).
- Check **Live run** only when a recorded Linux run in [linux-live-run.md](superpowers/plans/2026-10-17-roadmap-completion/linux-live-run.md) covered that row.
- Check **Mac (optional)** only when a recorded MacBook run covered that row. One run covers many rows. Mac never blocks a tag. Do not live-test every PR.
- **Blockers from Mac runs** at the bottom catch E2E findings from optional Mac proof. Fix locally. Retest on the next Linux live run. They do not start the next version.

**Current era:** Version 5 closed at `v5.0.0`. Version 4’s Linux live run is recorded (2026-10-18). Version 5’s Linux live run is recorded the same day. A Mac run does not close a version.

**Current package:** `5.17.0`. `v6.0.0` waits for UI plan row 16 (cutover). **`v5.1.0` is cut when this release lands** (not tagged in this commit). **`v5.0.1` is cut when that release lands** (not tagged in this commit). **`v5.0.0` is cut when that release lands** (not tagged in this commit). **`v4.5.0` is cut when that release lands** (not tagged in this commit). **`v4.4.0` is tagged.** **`v4.3.0` is not tagged yet.** **`v4.2.0`, `v4.1.0`, and `v4.0.0` are already tagged.** Version 3’s two Notes rows stay open: markdown tables, and bold/italic, because no live digest contained them. The 2026-09-20 Mac blockers were retested on the 2026-10-17 run.

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
| Version 2 | Version 3 shell | Version 2 features implemented + locally tested. **Passed** (`v2.0.0` tagged; shell is `v2.1.0`). Leftover proof rides the Version 3 Linux live run. Mac proof is optional. |
| Version 3 work | **`v3.0.0` tag** | Linux live run recorded 2026-10-17. Package `3.0.0` is tagged. Tables and emphasis were not in any live digest, so those two checklist rows stay open. Mac does not block the tag. |
| Version 3 | Version 4 | **Passed.** Linux live run recorded 2026-10-18. Package `4.0.0`. Tag `v4.0.0` when this release lands. |
| Version 4 | Version 5 | **Passed.** Linux live run recorded 2026-10-18. Package `5.0.0`. Tag `v5.0.0` when this release lands. |

Local commands (every change):

```bash
cd python && uv run pytest -q
cd desktop/src-tauri && cargo test
cd desktop && npm test && npm run build
```

Linux live run script for the current era: [linux-live-run.md](superpowers/plans/2026-10-17-roadmap-completion/linux-live-run.md). [mac-e2e.md](superpowers/plans/2026-08-22-v3-program/mac-e2e.md) is the optional Mac script and does not block a tag. Next-phase engineering: [2026-09-12-v3-notes-gate.md](superpowers/plans/2026-09-12-v3-notes-gate.md).

---

## Version 1 — smallest useful app

Shipped as part of `v2.0.0`. GitHub issues #3, #4, #19, #21.

| Item | Issue | Implemented | Local/VM | Live run | Mac (optional) | Notes |
|------|-------|-------------|----------|----------|----------------|-------|
| Desktop app, Update, PDF/PPTX, course folders, dated digests, git commit | — | [x] | [x] | [x] | [x] | 2026-10-17 boxes 1 and 11. Clin Med 2 remains the Mac note. |
| Digest prompt source rules + reject `\(`, `\[`, `\frac` on create/regenerate | [#3](https://github.com/MrF1ow/Arbor/issues/3) | [x] | [x] | [ ] | [x] | Live run reported no LaTeX |
| `validate_digest` on **patch** splices | [#3](https://github.com/MrF1ow/Arbor/issues/3) follow-up | [x] | [x] | n/a | n/a | `_apply_patch` validates each provider splice. |
| Codex GUI PATH, 10s timeout, single-flight auth | [#19](https://github.com/MrF1ow/Arbor/issues/19) | [x] | [x] | [ ] | [ ] | Homebrew paths added in 2.2.0; Finder proof is optional Mac proof; Linux live run is the gate |
| Manifest v2, fingerprints, page markers, dirty ranges, in-place patch | [#21](https://github.com/MrF1ow/Arbor/issues/21) | [x] | [x] | [ ] | [x] | Clin Med 2 |
| Single-digest `course.md` index (not a full copy) | [#21](https://github.com/MrF1ow/Arbor/issues/21) | [x] | [x] | [x] | [ ] | 2026-10-17 box 3. The index link opened the digest. |
| DMG + bundled `arbor-worker` sidecar | [#4](https://github.com/MrF1ow/Arbor/issues/4) | [x] | [x] CI builds DMG | [x] | [ ] | 2026-10-17 box 14: AppImage and deb launched on Xvfb without the repo or `uv`. Finder install remains optional. Signing is not required. |

---

## Version 2 — automation

Shipped `v2.0.0`. Do not add features here. Leftover proof rides the Version 3 Linux live run (issue #30). Mac proof is optional.

| Item | Issue | Implemented | Local/VM | Live run | Mac (optional) | Notes |
|------|-------|-------------|----------|----------|----------------|-------|
| Job spine, single-flight, history | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [x] | [x] | 2026-10-17 job history across boxes 1–13 |
| FTS search + reindex | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [x] | [x] | 2026-10-17 box 5 |
| Folder watch → review | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [x] | [x] | 2026-10-17 box 6 |
| Optional `auto_update` | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [ ] | [ ] | Left off during the live run. Not proven. |
| Desktop notification on job end | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | n/a Linux agent | [x] | [ ] | 2026-10-17 box 12, private bus only |
| Word `.docx` ingest | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [x] | [ ] | 2026-10-17 box 1. The model omitted `DOCTOKEN`; the job succeeded. |
| OCR fallback (Tesseract) | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [x] | [ ] | 2026-10-17 box 13 |

---

## Version 3 — study app (shipped)

Package `3.0.0`, tagged `v3.0.0`. The 2026-10-17 Linux live run is recorded. Tables and emphasis stayed unchecked.

### Shipped (do not re-do)

| Item | Implemented | Local/VM | Live run | Mac (optional) |
|------|-------------|----------|----------|----------------|
| Desktop shell (sidebar, Notes preview, jobs, settings) `v2.1.0` | [x] | [x] | [x] | [ ] |
| Study generate jobs, skill protocol, retries | [x] | [x] | [x] | [ ] |
| Flashcards generate / flip / Again / Wrong / Mastered | [x] | [x] | [x] | [ ] |
| Quiz generate / submit / session answers | [x] | [x] | [x] | [ ] |
| Source chips → heading scroll | [x] | [x] | [x] | [ ] |
| Local embeddings + semantic search | [x] | [x] | [x] | [ ] |
| Concepts, graph-lite, figure merge, citation badges | [x] | [x] | [x] | [ ] |
| Add class, add files, theme, hide `_arbor_cache`, H1 digest titles | [x] | [x] | [x] | [ ] |
| Nested/ordered lists, bold, italic, inline code in Notes | [x] | [x] | [ ] | [ ] |

### Notes leftovers — implemented locally, live-run proof open

Issue [#42](https://github.com/MrF1ow/Arbor/issues/42) and the #3 patch-validation follow-up landed on `main`. The plan is [2026-09-12-v3-notes-gate.md](superpowers/plans/2026-09-12-v3-notes-gate.md). Live run boxes stay open until a run of the current package records them in [linux-live-run.md](superpowers/plans/2026-10-17-roadmap-completion/linux-live-run.md).

| Item | Issue | Implemented | Local/VM | Live run | Mac (optional) |
|------|-------|-------------|----------|----------|----------------|
| Markdown links render; `digests/*.md` opens that digest in Notes | [#42](https://github.com/MrF1ow/Arbor/issues/42) | [x] | [x] | [x] | [ ] |
| Markdown tables render as tables | [#42](https://github.com/MrF1ow/Arbor/issues/42) | [x] | [x] | [ ] | [ ] |
| Closing `arbor-pages` markers stripped from the reading pane | [#42](https://github.com/MrF1ow/Arbor/issues/42) | [x] | [x] | [x] | [ ] |
| Shared reserved-dir policy (`_arbor_cache`, `.arbor`, `study`, `digests` at Knowledge root) | [#42](https://github.com/MrF1ow/Arbor/issues/42) | [x] | [x] | [x] | [ ] |
| Long digest scrolls end-to-end in the real Arbor window | [#42](https://github.com/MrF1ow/Arbor/issues/42) | CSS present | [x] CSS unit tests | [x] | [ ] |
| `validate_digest` on patch output | [#3](https://github.com/MrF1ow/Arbor/issues/3) | [x] | [x] | n/a | n/a |

### Version 3 Linux live run (the open gate)

Pass conditions are the Version 3 script table in [linux-live-run.md](superpowers/plans/2026-10-17-roadmap-completion/linux-live-run.md). Record date, commit, and results there and tick **Live run** on the rows above.

**Optional Mac proof (does not close Version 3):** 2026-09-20 partial run (issue [#57](https://github.com/MrF1ow/Arbor/issues/57)). Failures are in the Blockers table below.

The 2026-10-17 run is recorded. Package **`3.0.0`** is tagged. Tables and emphasis remain open on this checklist.

---

## Version 4 — tutor (shipped)

Issue [#20](https://github.com/MrF1ow/Arbor/issues/20). Shipped as package `4.0.0`. The 2026-10-18 Linux live run is recorded. Behavioral Medicine was not available. The fixture course Saltmarsh stands in for that acceptance row. **`v4.0.0` is tagged.** Issue #20 stays open until the parent closes it.

| Item | Implemented | Local/VM | Live run | Mac (optional) |
|------|-------------|----------|----------|----------------|
| Chat tab on selected Knowledge root + course | [x] | [x] | [x] | [ ] |
| Retrieve `course.md` / digests / page metadata before Codex | [x] | [x] | [x] | [ ] |
| Source-grounded answers; say when unsupported | [x] | [x] | [x] | [ ] |
| Clickable digest/page citations | [x] | [x] | [x] | [ ] |
| Per-course history; new/clear chat | [x] | [x] | [x] | [ ] |
| Read-only Knowledge unless user asks to generate | [x] | [x] | [x] | [ ] |
| Stream progress; auth/error states | [x] | [x] | [x] | [ ] |
| Ask / Explain / Quiz modes from course material only | [x] | [x] | [x] | [ ] |
| Behavioral Medicine cited-answer acceptance run (Linux live run) | [x] | [x] | [x] | [ ] |

Live-run notes: T1 covers the chat tab, retrieval, the covered answer, and the clickable page citation. T2 covers the unsupported banner. T3 covers Explain and Quiz. T4 covers history, New, and Clear. T5 covers read-only chat. T7 covers the signed-out badge. The cited-answer row used Saltmarsh (three lecture PDFs ingested with Grok `grok-4.7`), not Behavioral Medicine. The provider on the live run was Grok, which is the Linux live-run provider. Codex remains the unit-tested path.

Also Version 4 (not extra GitHub issues): review scheduling, weak-topic detection, study plans, and make-card-from-selection passed on Saltmarsh as box T6. Extra AI providers shipped in `3.5.0` and were not re-smoked on this run. Grok signed-out is T7.

---

## Version 5 — collaboration (closed at `v5.0.0`)

No current GitHub issue for the milestone. Cloud sync, shared libraries, marketplaces, permissions, remote workers. Version 4 is closed at `v4.0.0`. This package is `5.17.0`.

| Item | Implemented | Local/VM | Live run | Mac (optional) |
|------|-------------|----------|----------|----------------|
| Git remote sync (`v4.1.0`) | [x] | [x] | [x] | [ ] |
| Shared libraries and team workspaces (`v4.2.0`) | [x] | [x] | [x] | [ ] |
| Skill packages and marketplace (`v4.3.0`) | [x] | [x] | [ ] | [ ] |
| Library roles and shared provider profiles (v4.4.0) | [x] | [x] | [x] | [ ] |
| Remote workers over SSH (v4.5.0) | [x] | [x] | [x] | [ ] |

Git remote sync: boxes C1 and C2. Shared libraries and per-user progress: boxes C1 and C3. Skill packages: box C4 installed, confirmed, and uninstalled the local `anki-export` pin. The run did not write the TSV. The folder picker never accepted Open (issue #70), so that Live run box stays open. Role checks: box C5. The UI disabled write jobs and the worker refused. The git host's permissions remain the real control. Remote workers: box C6, private sshd on 127.0.0.1:22222, local commit after sync back. Host keys stayed in the Arbor-managed file. `~/.ssh` was unchanged.

---

## Blockers from Mac runs

Add a row when a Mac batch finds a failure. Status starts as implemented-no / local-no. Fix locally. Retest on the **next** Linux live run, not a dedicated trip.

| Date | Version | Finding | Implemented | Local/VM | Next live run |
|------|---------|---------|-------------|----------|---------------|
| 2026-09-20 | 3 / `2.2.0` | [#57](https://github.com/MrF1ow/Arbor/issues/57) Concepts job fails: `unknown concept edge` when the model uses node labels. Graph is blocked. | [x] | [x] | [x] |
| 2026-09-20 | 3 / `2.2.0` | [#57](https://github.com/MrF1ow/Arbor/issues/57) Check citations marks honest flashcards Unverified (`**copperleaf**` vs `Copperleaf.`). | [x] | [x] | [x] |
| 2026-09-20 | 3 / `2.2.0` | [#57](https://github.com/MrF1ow/Arbor/issues/57) Create Class rejects reserved names such as `study` with no visible error. | [x] | [x] | [x] |
| 2026-09-20 | 3 / `2.2.0` | [#57](https://github.com/MrF1ow/Arbor/issues/57) Quiz shows per-question correctness only. No session score such as `4 / 6 correct`. Improvement, not a failure. | [x] | [x] | [x] |

---

## Stale GitHub hygiene (does not block versions)

Operator can close when the checklist row is done. Code already matches the original AC:

- #3 (except patch-validation follow-up)
- #4 (except Finder proof; packaged Linux build in linux-live-run.md is the gate; optional Mac Finder proof; do not wait on notarization)
- #19
- #21
- PR [#31](https://github.com/MrF1ow/Arbor/pull/31) superseded by merged #32

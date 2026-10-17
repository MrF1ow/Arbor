# Implementation checklist

Living tracker for **implemented / locally tested / live-run tested**. Capability intent and GitHub issue text live in [`PROJECT.md`](../PROJECT.md). Mac proof is optional. This file is the gate.

**How to use**

- Check **Implemented** when the code is on `main`.
- Check **Local/VM** when pytest, cargo, and npm tests for that row are green (Linux agents and CI).
- Check **Live run** only when a recorded Linux run in [linux-live-run.md](superpowers/plans/2026-10-17-roadmap-completion/linux-live-run.md) covered that row.
- Check **Mac (optional)** only when a recorded MacBook run covered that row. One run covers many rows. Mac never blocks a tag. Do not live-test every PR.
- **Blockers from Mac runs** at the bottom catch E2E findings from optional Mac proof. Fix locally. Retest on the next Linux live run. They do not start the next version.

**Current era:** Version 3. **Next version (Version 4) is blocked** until the Version 3 Linux live run is recorded. A Mac run does not close Version 3.

**Current package:** `2.3.0` (tag `v2.3.0`). **`v3.0.0` is not tagged.** The Linux live run uses the current package. The 2026-09-20 Mac batch recorded failures in the Blockers table and does not close Version 3.

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
| Version 3 work | **`v3.0.0` tag** | All Version 3 required rows implemented + locally tested **and** one Linux live run recorded in [linux-live-run.md](superpowers/plans/2026-10-17-roadmap-completion/linux-live-run.md). **Not passed.** Mac does not block it. |
| Version 3 | Version 4 | `v3.0.0` tagged. **Blocked.** Do not implement issue #20 until then. |
| Version 4 | Version 5 | `v4.0.0` tagged after a Version 4 Linux live run. |

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
| Desktop app, Update, PDF/PPTX, course folders, dated digests, git commit | — | [x] | [x] | [ ] | [x] | Clin Med 2 run on #30 (2026-08-22) |
| Digest prompt source rules + reject `\(`, `\[`, `\frac` on create/regenerate | [#3](https://github.com/MrF1ow/Arbor/issues/3) | [x] | [x] | [ ] | [x] | Live run reported no LaTeX |
| `validate_digest` on **patch** splices | [#3](https://github.com/MrF1ow/Arbor/issues/3) follow-up | [x] | [x] | n/a until local | n/a until local | `_apply_patch` validates each provider splice. |
| Codex GUI PATH, 10s timeout, single-flight auth | [#19](https://github.com/MrF1ow/Arbor/issues/19) | [x] | [x] | [ ] | [ ] | Homebrew paths added in 2.2.0; Finder proof is optional Mac proof; Linux live run is the gate |
| Manifest v2, fingerprints, page markers, dirty ranges, in-place patch | [#21](https://github.com/MrF1ow/Arbor/issues/21) | [x] | [x] | [ ] | [x] | Clin Med 2 |
| Single-digest `course.md` index (not a full copy) | [#21](https://github.com/MrF1ow/Arbor/issues/21) | [x] | [x] | [ ] | [ ] | Index is written; **link rendering** is Version 3 Notes |
| DMG + bundled `arbor-worker` sidecar | [#4](https://github.com/MrF1ow/Arbor/issues/4) | [x] | [x] CI builds DMG | [ ] | [ ] | Packaged Linux build in linux-live-run.md is the gate; Finder install without repo/`uv` is optional Mac proof. Signing is not required. |

---

## Version 2 — automation

Shipped `v2.0.0`. Do not add features here. Leftover proof rides the Version 3 Linux live run (issue #30). Mac proof is optional.

| Item | Issue | Implemented | Local/VM | Live run | Mac (optional) | Notes |
|------|-------|-------------|----------|----------|----------------|-------|
| Job spine, single-flight, history | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [ ] | [x] | Clin Med 2 job history |
| FTS search + reindex | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [ ] | [x] | Search UI open-from-overlay still on Version 3 batch |
| Folder watch → review | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [ ] | [x] | Verified after #32 |
| Optional `auto_update` | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [ ] | [ ] | Optional on Mac batch |
| Desktop notification on job end | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | n/a Linux agent | [ ] | [ ] | Linux live run is the proof; Mac is optional |
| Word `.docx` ingest | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [ ] | [ ] | Linux live run is the proof; Mac is optional |
| OCR fallback (Tesseract) | [#30](https://github.com/MrF1ow/Arbor/issues/30) | [x] | [x] | [ ] | [ ] | Optional if Tesseract missing |

---

## Version 3 — study app (current)

Package `2.3.0` on `main` (tag `v2.3.0`). **`v3.0.0` is blocked on the Linux live run.** The implementation rows below are done and locally tested.

### Shipped (do not re-do)

| Item | Implemented | Local/VM | Live run | Mac (optional) |
|------|-------------|----------|----------|----------------|
| Desktop shell (sidebar, Notes preview, jobs, settings) `v2.1.0` | [x] | [x] | [ ] | [ ] |
| Study generate jobs, skill protocol, retries | [x] | [x] | [ ] | [ ] |
| Flashcards generate / flip / Again / Wrong / Mastered | [x] | [x] | [ ] | [ ] |
| Quiz generate / submit / session answers | [x] | [x] | [ ] | [ ] |
| Source chips → heading scroll | [x] | [x] | [ ] | [ ] |
| Local embeddings + semantic search | [x] | [x] | [ ] | [ ] |
| Concepts, graph-lite, figure merge, citation badges | [x] | [x] | [ ] | [ ] |
| Add class, add files, theme, hide `_arbor_cache`, H1 digest titles | [x] | [x] | [ ] | [ ] |
| Nested/ordered lists, bold, italic, inline code in Notes | [x] | [x] | [ ] | [ ] |

### Notes leftovers — implemented locally, live-run proof open

Issue [#42](https://github.com/MrF1ow/Arbor/issues/42) and the #3 patch-validation follow-up landed on `main`. The plan is [2026-09-12-v3-notes-gate.md](superpowers/plans/2026-09-12-v3-notes-gate.md). Live run boxes stay open until a run of the current package records them in [linux-live-run.md](superpowers/plans/2026-10-17-roadmap-completion/linux-live-run.md).

| Item | Issue | Implemented | Local/VM | Live run | Mac (optional) |
|------|-------|-------------|----------|----------|----------------|
| Markdown links render; `digests/*.md` opens that digest in Notes | [#42](https://github.com/MrF1ow/Arbor/issues/42) | [x] | [x] | [ ] | [ ] |
| Markdown tables render as tables | [#42](https://github.com/MrF1ow/Arbor/issues/42) | [x] | [x] | [ ] | [ ] |
| Closing `arbor-pages` markers stripped from the reading pane | [#42](https://github.com/MrF1ow/Arbor/issues/42) | [x] | [x] | [ ] | [ ] |
| Shared reserved-dir policy (`_arbor_cache`, `.arbor`, `study`, `digests` at Knowledge root) | [#42](https://github.com/MrF1ow/Arbor/issues/42) | [x] | [x] | [ ] | [ ] |
| Long digest scrolls end-to-end in the real Arbor window | [#42](https://github.com/MrF1ow/Arbor/issues/42) | CSS present | [x] CSS unit tests | [ ] | [ ] |
| `validate_digest` on patch output | [#3](https://github.com/MrF1ow/Arbor/issues/3) | [x] | [x] | n/a | n/a |

### Version 3 Linux live run (the open gate)

Pass conditions are the Version 3 script table in [linux-live-run.md](superpowers/plans/2026-10-17-roadmap-completion/linux-live-run.md). Record date, commit, and results there and tick **Live run** on the rows above.

**Optional Mac proof (does not close Version 3):** 2026-09-20 partial run (issue [#57](https://github.com/MrF1ow/Arbor/issues/57)). Failures are in the Blockers table below.

After a clean Linux live run is recorded, tag **`v3.0.0`**. Only then may Version 4 start, as `v3.1.0`, `v3.2.0`, and so on.

---

## Version 4 — tutor (blocked)

Issue [#20](https://github.com/MrF1ow/Arbor/issues/20). Do not check these until Version 3 is closed.

| Item | Implemented | Local/VM | Live run | Mac (optional) |
|------|-------------|----------|----------|----------------|
| Chat tab on selected Knowledge root + course | [ ] | [ ] | [ ] | [ ] |
| Retrieve `course.md` / digests / page metadata before Codex | [ ] | [ ] | [ ] | [ ] |
| Source-grounded answers; say when unsupported | [ ] | [ ] | [ ] | [ ] |
| Clickable digest/page citations | [ ] | [ ] | [ ] | [ ] |
| Per-course history; new/clear chat | [ ] | [ ] | [ ] | [ ] |
| Read-only Knowledge unless user asks to generate | [ ] | [ ] | [ ] | [ ] |
| Stream progress; auth/error states | [ ] | [ ] | [ ] | [ ] |
| Ask / Explain / Quiz modes from course material only | [ ] | [ ] | [ ] | [ ] |
| Behavioral Medicine cited-answer acceptance run (Linux live run) | [ ] | [ ] | [ ] | [ ] |

Also Version 4 (not extra GitHub issues): review scheduling, weak-topic detection, study plans, make-card-from-selection, extra AI providers.

---

## Version 5 — collaboration (blocked)

No current GitHub issue. Cloud sync, shared libraries, marketplaces, permissions, remote workers. Starts after `v4.0.0`.

---

## Blockers from Mac runs

Add a row when a Mac batch finds a failure. Status starts as implemented-no / local-no. Fix locally. Retest on the **next** Linux live run, not a dedicated trip.

| Date | Version | Finding | Implemented | Local/VM | Next live run |
|------|---------|---------|-------------|----------|---------------|
| 2026-09-20 | 3 / `2.2.0` | [#57](https://github.com/MrF1ow/Arbor/issues/57) Concepts job fails: `unknown concept edge` when the model uses node labels. Graph is blocked. | [x] | [x] | [ ] |
| 2026-09-20 | 3 / `2.2.0` | [#57](https://github.com/MrF1ow/Arbor/issues/57) Check citations marks honest flashcards Unverified (`**copperleaf**` vs `Copperleaf.`). | [x] | [x] | [ ] |
| 2026-09-20 | 3 / `2.2.0` | [#57](https://github.com/MrF1ow/Arbor/issues/57) Create Class rejects reserved names such as `study` with no visible error. | [x] | [x] | [ ] |
| 2026-09-20 | 3 / `2.2.0` | [#57](https://github.com/MrF1ow/Arbor/issues/57) Quiz shows per-question correctness only. No session score such as `4 / 6 correct`. Improvement, not a failure. | [x] | [x] | [ ] |

---

## Stale GitHub hygiene (does not block versions)

Operator can close when the checklist row is done. Code already matches the original AC:

- #3 (except patch-validation follow-up)
- #4 (except Finder proof; packaged Linux build in linux-live-run.md is the gate; optional Mac Finder proof; do not wait on notarization)
- #19
- #21
- PR [#31](https://github.com/MrF1ow/Arbor/pull/31) superseded by merged #32

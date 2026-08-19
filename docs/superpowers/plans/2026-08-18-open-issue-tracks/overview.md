# Open issue tracks

> **Playbook:** poteto-mode multi-phase plan. Plan only. Do not implement from this document until the user starts execution.
>
> **Issues:** [#19](https://github.com/MrF1ow/Arbor/issues/19), [#3](https://github.com/MrF1ow/Arbor/issues/3), [#21](https://github.com/MrF1ow/Arbor/issues/21), [#6](https://github.com/MrF1ow/Arbor/issues/6). Later, not this program: [#4](https://github.com/MrF1ow/Arbor/issues/4), [#20](https://github.com/MrF1ow/Arbor/issues/20).

**Goal:** Make GUI Codex auth reliable, lock digest formatting, and finish the incremental-knowledge path that the Aug 12 fingerprinting plan specified but did not wire into ingest.

## Context

V1, large-PDF chunking, and course-centric ingest are on `main`. Fingerprinting PRs merged a spec, a nine-phase plan, and a `sources` storage API. Runtime ingest still writes `arbor-course.json` version 1 with no fingerprints and no page markers. `course.md` is always an LLM copy of whatever digests exist, so a first lecture duplicates `digests/YYYY-MM-DD.md`. Finder-launched Arbor misses `~/.local/bin/codex`. The digest prompt still allows LaTeX.

That is the gap a real Behavioral Medicine run hit. Fix it before packaging or chat.

## Scope

**Included**

- #19 worker discovery, auth timeout, and desktop in-flight guard
- #3 source-boundary and portable-Markdown rules on digest, chunk, and lecture-synthesis prompts
- #21 resume of [page fingerprinting](../2026-08-12-page-fingerprinting/overview.md) from phase 2, plus a single-digest `course.md` index instead of a full rollup
- Close #6 after fingerprints persist, with a comment that course-centric plus fingerprinting is the layout decision

**Excluded**

- #4 macOS DMG and bundled worker. Needs its own plan after #19. Tauri `bundle.active` is already true. The remaining work is sidecar Python, not PATH.
- #20 in-app chat. That is `PROJECT.md` Version 4. Spec it after incremental knowledge is live.
- `PROJECT.md` Version 2 and Version 3 (watchers, SQLite, flashcards, extra providers)
- A second fingerprinting design. The 2026-08-12 spec stays authoritative.
- Rewriting the existing nine phase files. Resume them. Add only the `course.md` delta.

## Constraints

- Python 3.11+ worker, pytest, existing `FakeProvider` patterns under `python/`
- Tauri v2 desktop. Plan JSON between UI and worker.
- Codex CLI stays an external binary. Do not bundle it in this program.
- Fingerprints live in committed `arbor-course.json`, not `_arbor_cache/`
- Chunked generate stays the engine for large windows
- `poteto-agent` is not registered in this Cursor Task roster. Delegates use `generalPurpose`.
- No `control-ui` or `control-cli` skill is installed for this stack. Flag runtime gaps in each desktop phase.

## Alternatives

1. **Program plan that resumes fingerprinting, plus two small independent tracks.** Chosen. #19 and #3 do not share files with phases 2 through 7 of fingerprinting. #21 is unfinished work on an existing plan, not a new design.
2. **Rewrite fingerprinting as a new plan.** Rejected. The phase files already name types, files, and checks. Duplicating them invites drift.
3. **Fan out one agent per fingerprinting phase.** Rejected. `pipeline.py`, `planning.py`, `course_manifest.py`, and `desktop/src/main.ts` are single-writer files. Parallel agents would serialize on those anyway, worse.

## Applicable skills

- **how** before changing `auth`, `provider/codex`, `digest`, `planning`, `pipeline`, or desktop `main.ts`
- **tdd** / project pytest per phase
- **unslop** / **technical-writing** for README and issue-closing comments
- **interrogate** before shipping alignment, patch-versus-regenerate, or `course.md` index copy
- **show-me-your-work** on the fingerprinting stack
- **no-comments** before review
- After a PR opens, Cursor built-in **babysit**

## Delegation

Two owners may run at once in wave 1. One owner runs the fingerprinting stack. The coordinator (this chat) reviews diffs, not summaries.

| Wave | Issue | Owner | Model | Files (exclusive) | Parallel with |
|------|-------|-------|-------|-------------------|---------------|
| 1a | #19 worker | Agent A | Grok 4.6 High (`inherit-parent`) | `auth.py`, `provider/codex.py`, `tests/test_auth.py` | 1b, 1c |
| 1b | #19 UI | Agent B | Grok 4.6 High (`inherit-parent`) | `desktop/src/main.ts` only | 1a, 1c. **Not** fingerprinting phase 9 |
| 1c | #3 | Agent C | Grok 4.6 High (`inherit-parent`) | `digest.py`, `tests/test_digest.py` | 1a, 1b |
| 2a | #21 new modules | Agents D1–D3 | Grok 4.6 High (`inherit-parent`) | fingerprinting phases 2, 3, 5 as **new files only** | each other, after wave 1 |
| 2b | #21 planning + markers in generate | Agents D4, D6 | Grok 4.6 High (`inherit-parent`) | phase 4 (`planning.py`) and phase 6 (`digest.py`) | each other, after 2a. **Not** with wave 1c (`digest.py`) |
| 2c | #21 patch | Agent D7 | Grok 4.6 High (`inherit-parent`) | phase 7 new `digest_update.py` | after 2b |
| 2d | #21 pipeline | Agent D8 | Grok 4.6 High (`inherit-parent`) | phase 8 plus [phase 5 of this plan](phase-5-single-digest-course-index.md) | nothing. Owns `pipeline.py` |
| 2e | #21 desktop ranges | Agent D9 | Grok 4.6 High (`inherit-parent`) | phase 9 `main.ts` | after wave 1b and 2d |
| 3 | #6 | Coordinator | n/a | GitHub comment and close | after wave 2 phase 8 persists `sources` |
| later | #4, #20 | new plans | n/a | not this directory | after wave 2 is on `main` |

**Do not** give two agents `pipeline.py`, `planning.py`, `digest.py`, or `desktop/src/main.ts` at the same time. Wave 1c (`digest.py`) must land before fingerprinting phase 6. Wave 1b must land before fingerprinting phase 9.

**Lever for wave 2.** Each owner reads [2026-08-12-page-fingerprinting/overview.md](../2026-08-12-page-fingerprinting/overview.md) and one named phase file. No parallel design. The coordinator inspects `git diff` after every phase.

Root and `python/README.md` already describe ranges and markers as live. Do not treat those docs as implementation status. `desktop/README.md` still matches start-page code.

## Phases

1. [Codex CLI resolve and auth timeout](phase-1-codex-cli-resolve.md)
2. [Desktop auth in-flight guard](phase-2-auth-inflight-guard.md)
3. [Digest prompt rules](phase-3-digest-prompt-rules.md)
4. [Resume page fingerprinting](phase-4-resume-fingerprinting.md)
5. [Single-digest course index](phase-5-single-digest-course-index.md)
6. [Testing and close-out](testing.md)

Phases 1 through 3 are wave 1. Phase 4 is the existing fingerprinting sequence, with new-module phases allowed in parallel. Phase 5 lands inside fingerprinting phase 8 on the same owner, as a required addendum, so `pipeline.py` moves once. Phase 6 is verification and issue hygiene.

## Verification

```bash
cd python && uv run pytest -q
cd desktop/src-tauri && cargo test
cd desktop && npm run build
```

Runtime gaps (no control skill): Finder-like empty `PATH` for #19; a one-digest course folder for #21 `course.md`; a grown mega-PDF for fingerprint ranges. Commands that approximate those are in [testing.md](testing.md).

## Implementation guidance

Implementers must:

1. Read the **how** skill over each unfamiliar subsystem before edits.
2. Keep each phase to its listed files. Wave 1c must not touch `pipeline.py`.
3. Treat ranges as the selection shape in wave 2. Migrate callers off `start_page` in fingerprinting phase 8, then delete it (**migrate-callers-then-delete-legacy-apis**).
4. Run `/deslop` before commit. Apply **unslop** to README, issue comments, and PR prose.
5. Keep a **show-me-your-work** trail for wave 2.
6. After opening a PR, the parent runs Cursor **babysit**. The implementer does not.
7. **interrogate** alignment confidence, patch-versus-regenerate, and the single-digest index copy before calling #21 done.

## File map (implementer index)

| Area | Pointers |
|------|----------|
| Auth | `python/src/arbor_worker/auth.py`, `provider/codex.py`, `python/tests/test_auth.py` |
| Desktop auth | `desktop/src/main.ts` (`refreshAuth`, `window` `focus`) |
| Prompts | `python/src/arbor_worker/digest.py`, `python/tests/test_digest.py` |
| Course rollup | `python/src/arbor_worker/course_synthesis.py`, `pipeline.py` (wave 2 only), `python/tests/test_course_synthesis.py` |
| Manifest | `python/src/arbor_worker/course_manifest.py` (API exists; pipeline does not call `set_source`) |
| Fingerprinting plan | `docs/superpowers/plans/2026-08-12-page-fingerprinting/` |
| Specs | `docs/superpowers/specs/2026-08-12-page-fingerprinting-design.md`, `docs/superpowers/specs/2026-08-12-course-centric-knowledge-design.md` |

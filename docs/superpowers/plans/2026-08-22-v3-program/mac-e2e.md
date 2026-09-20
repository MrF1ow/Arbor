# Mac E2E ingest checklist

Parent: [overview.md](overview.md)

**Status:** still open. Living ledger: [`docs/implementation-checklist.md`](../../../implementation-checklist.md). Record a run **once** after the Version 3 Notes leftovers in [2026-09-12-v3-notes-gate.md](../2026-09-12-v3-notes-gate.md) are locally green. This is the Version 3 Mac batch. It also covers leftover Version 2 proof from issue [#30](https://github.com/MrF1ow/Arbor/issues/30).

GitHub issue [#42](https://github.com/MrF1ow/Arbor/issues/42) is Notes UX, not this file’s tracker. Write the run record in this file and on the implementation checklist.

## Goal

Prove the v2 ingest loop still works in the Version 3 shell, prove the study loop, and prove Notes leftovers (links, tables, scroll). A classmate can pick a folder, Update, Confirm, commit, search, watch-review, generate a deck, grade a card, take a quiz, click a `course.md` digest link, and open a heading chip.

Do not run this after every small PR. Linux/VM tests gate merges. This batch gates **`v3.0.0`**.

## Checklist

Run on a Mac with Codex CLI authenticated. Use a throwaway Knowledge git repo and a small PDF.

- [ ] Fresh Knowledge folder, git init, pick it in Arbor
- [ ] Update knowledge → review table → Confirm
- [ ] Digest written under `digests/`, `course.md` updated, git commit appears
- [ ] Notes mode shows the digest preview (serif, page-marker chips). Closing `arbor-pages` comments are not visible as text
- [ ] Search overlay finds a word from the digest and opens Notes at that file
- [ ] Drop a second PDF into the course folder. Watch opens review. Confirm ingests it
- [ ] Inspector log stays collapsed until Update or a running job
- [ ] Settings toggles persist in `.arbor/settings.json`

## Study loop (Wave 8)

- [ ] Flashcards Generate on a course with a digest (Codex if a model is selected, fake if not)
- [ ] Flip, then Again / Wrong / Mastered. Next card is face down. `.arbor/progress/<course>.flashcards.json` updates
- [ ] Quiz Generate, Submit, Previous, Submit again. Score for that question does not increase
- [ ] Source chip on a card with a heading opens Notes scrolled to that heading
- [ ] Search overlay Semantic toggle returns a hit and opens Notes
- [ ] Graph Generate, click a source chip, Notes opens
- [ ] Check citations. An invented card back shows Unverified. Honest cards do not

## Notes leftovers (issue #42)

- [ ] Course overview (`course.md`) shows a clickable digest link, not raw `[file](digests/file)`
- [ ] That link opens the digest in Notes
- [ ] A table in a digest renders as a table
- [ ] A long digest scrolls from beginning to end in the reading pane
- [ ] `_arbor_cache` is not listed as a class. Creating a class named `study` is rejected

## Leftover Version 2 proof (issue #30)

- [ ] Recent runs shows the succeeded job; Log shows JSONL
- [ ] Start a second Update while one is running → rejected
- [ ] macOS notification on job finish
- [ ] A `.docx` ingests into a digest
- [ ] Finder-launched DMG (no checkout, no `uv`, no `ARBOR_REPO_DIR`) can pick a folder, pass Codex auth, and run Update
- [ ] (Optional) `auto_update` starts a job on file drop
- [ ] (Optional) scanned PDF with Tesseract still produces a digest

## Record

When done, fill this in **here** and on `docs/implementation-checklist.md`. Then the operator may tag `v3.0.0`. `v2.2.0` is already tagged. Version 4 must not start before `v3.0.0`.

### 2026-09-20 (partial, issue [#57](https://github.com/MrF1ow/Arbor/issues/57))

This run does **not** close Version 3. Do not tag `v3.0.0` from it.

- Date: 2026-09-20
- macOS version: not recorded in #57
- Apple Silicon / Intel: not recorded in #57
- Arbor build: package `2.2.0` / `main` after #56 (`v2.2.0`)
- Failures (copied onto the checklist Blockers table):
  - Concepts: `unknown concept edge: Synthetic handout -> Arbor Mac end-to-end workflow`. Graph blocked.
  - Citations: honest flashcards Unverified (`**copperleaf**` vs `Copperleaf.`).
  - Create Class: reserved name `study` rejected with no visible error.
  - Quiz session score (`N / M correct`) missing. Requested improvement, not a failure.
- Passes recorded in #57 (ingest, watch, Notes link/scroll/markers, lexical and semantic search, flashcards, quiz no double-count, settings persist, DOCX). Leave the boxes above unchecked until a later run re-confirms after the blocker fixes.
- Untested in #57: GFM table in a generated digest, Recent Runs / JSONL, second Update rejection, macOS notification, Finder DMG, optional auto-update and OCR.

## Static / runtime

Same as every wave. `uv run pytest -q`, `cargo test`, `npm test`, `npm run build`. This file is the missing runtime proof. A Linux agent cannot check the boxes.

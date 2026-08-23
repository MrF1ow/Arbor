# Mac E2E ingest checklist

Parent: [overview.md](overview.md)

**Status:** still open. Wave 0 shipped the shell in `v2.1.0`. Waves 1–7 are on `main`. Record a run before tagging `v3.0.0`. Closeout spec: [`../../specs/2026-08-23-v3-closeout-design.md`](../../specs/2026-08-23-v3-closeout-design.md). Issue [#42](https://github.com/MrF1ow/Arbor/issues/42).

## Goal

Prove the v2 ingest loop still works in the Version 3 shell, then prove the study loop. A classmate can pick a folder, Update, Confirm, commit, search, watch-review, generate a deck, grade a card, take a quiz, and open a heading chip.

## Checklist

Run on a Mac with Codex CLI authenticated. Use a throwaway Knowledge git repo and a small PDF.

- [ ] Fresh Knowledge folder, git init, pick it in Arbor
- [ ] Update knowledge → review table → Confirm
- [ ] Digest written under `digests/`, `course.md` updated, git commit appears
- [ ] Notes mode shows the digest preview (serif, page-marker chips)
- [ ] Search overlay finds a word from the digest and opens Notes at that file
- [ ] Drop a second PDF into the course folder. Watch opens review. Confirm ingests it.
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

Record date, macOS version, and Arbor build (commit or DMG tag) in a comment on issue #42 or in this file when done.

## Static / runtime

Same as every wave. `uv run pytest -q`, `cargo test`, `npm test`, `npm run build`. This file is the missing runtime proof. A Linux agent cannot check the boxes.

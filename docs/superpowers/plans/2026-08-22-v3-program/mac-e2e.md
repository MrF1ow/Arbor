# Mac E2E ingest checklist

Parent: [overview.md](overview.md)

**Status:** still open. Package `2.2.0` is on `main` at `2d556c5` (waves 1 through 8). Record a run before tagging `v3.0.0`. Closeout spec: [`../../specs/2026-08-23-v3-closeout-design.md`](../../specs/2026-08-23-v3-closeout-design.md). Issue [#42](https://github.com/MrF1ow/Arbor/issues/42).

## Goal

Prove the v2 ingest loop still works in the Version 3 shell, then prove the study loop. A classmate can pick a folder, Update, Confirm, commit, search, watch-review, generate a deck, grade a card, take a quiz, and open a heading chip.

## Repo and versions

Do this on a Mac. A Linux agent must not check the boxes below.

1. `git fetch origin main && git checkout main && git pull`. Confirm `git rev-parse --short HEAD` is `2d556c5` or a later commit on `main`.
2. Confirm package `2.2.0` in `python/pyproject.toml`, `desktop/package.json`, and `desktop/src-tauri/Cargo.toml`. `cd python && uv run arbor-worker --version` prints `2.2.0`.
3. Tag `v2.2.0` when you want the Release DMG. `git tag -a v2.2.0 2d556c5 -m "2.2.0" && git push origin v2.2.0`. Wait for `release-macos.yml`. Or run from source. `cd python && uv sync`. `cd desktop && npm install && npm run tauri dev`.
4. Log Codex CLI in. `cd python && uv run arbor-worker check-auth`.
5. Use a throwaway Knowledge git repo and a small PDF.
6. Work the ingest list and the study-loop list.
7. Fill **Last recorded run** or comment on issue [#42](https://github.com/MrF1ow/Arbor/issues/42) with date, `sw_vers`, and the build (`v2.2.0` or commit `2d556c5`).
8. Tag `v3.0.0` only after that record exists. Never tag `3.1.0` or `3.2.0`.

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

## Last recorded run

None yet. Leave this empty until a Mac fills it.

- Date:
- macOS (`sw_vers`):
- Arbor build:

## Static / runtime

Same as every wave. `uv run pytest -q`, `cargo test`, `npm test`, `npm run build`. This file is the missing runtime proof. A Linux agent cannot check the boxes.

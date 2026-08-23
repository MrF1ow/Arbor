# Mac E2E ingest checklist (Wave 0 leftover)

Parent: [overview.md](overview.md)

**Status:** still open. Wave 0 shipped the shell in `v2.1.0`. This checklist was never filled in on `main`.

Wave 1 can start without it. Record a run before any desktop-heavy wave (`v2.3.0` flashcards) ships.

## Goal

Prove the v2 ingest loop still works in the v2.1.0 shell. A classmate can pick a folder, Update, Confirm, commit, search, and watch-review without seeing a log until they start an Update.

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

Record date, macOS version, and Arbor build (commit or `v2.1.0` DMG) in a comment on the tracking issue or in this file when done.

## Static / runtime

Same as every wave. `uv run pytest -q`, `cargo test`, `npm run build`. This file is the missing **runtime** proof for Wave 0.

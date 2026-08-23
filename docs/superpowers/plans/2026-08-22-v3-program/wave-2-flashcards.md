# Wave 2: Flashcards (`v2.3.0`)

Parent: [overview.md](overview.md)

Depends on Wave 1.

## Goal

A student opens Biology → Flashcards, generates a deck from committed digests, flips cards, and refreshes after notes change without losing progress on unchanged cards.

## Data structures

- `study/flashcards.json` as in the [format spec](../../specs/2026-08-22-v3-study-artifacts-format.md)
- Card `id` = short hash of normalized `front` + `source.digest` (worker, not the model)
- `.arbor/progress/<course>.flashcards.json` `{ "id": { "seen", "correct", "wrong" } }`
- Setting `auto_generate.flashcards` default `false`

## PRs

| PR | Work | Verify |
|----|------|--------|
| 2.1 | `skills/flashcards.py` prompt, Pydantic deck, write JSON + manifest, git commit | `generate --skill flashcards --provider fake` on a Biology fixture |
| 2.2 | Stale detection. `--force`. `--force` false + unchanged SHA skips | `skill_stale_skipped` when digests unchanged |
| 2.3 | Desktop deck. Flip, next/prev, shuffle. Generate / Refresh from digests | Empty state Generate runs `start_study_job` |
| 2.4 | Stale badge. Source chip opens Notes at that digest | Edit a digest, badge appears, refresh clears it |
| 2.5 | Progress file gitignored. Survives refresh for stable ids | Delete `study/flashcards.json`, regenerate same fronts, progress remains |
| 2.6 | Settings toggle `auto_generate.flashcards` | After Update with toggle on, a study job is queued |

## Files

- Create: `python/src/arbor_worker/skills/flashcards.py`
- Create: `python/tests/test_skills_flashcards.py`
- Modify: `python/src/arbor_worker/settings.py`, `commands.py`
- Modify: `desktop/index.html`, `desktop/src/main.ts`, `desktop/src/styles.css`
- Modify: `desktop/src-tauri/src/commands.rs` (read study JSON, progress read/write)

## Verification

**Static.** pytest including fake-provider generate. cargo test. npm run build.

**Runtime.** Generate a deck from real Biology digests. Flip through. Edit a digest, see stale, refresh. Progress counts persist for cards whose `front` did not change. Ingest path still works.

## Decisions (do not reopen)

- One Codex call per course. Split per digest only when the concatenated digest text exceeds the skill budget, then merge and drop duplicate fronts.
- Model-supplied ids are ignored.

Wave 2 only increments `seen` on flip/next. Again / Wrong / Mastered are Wave 8 ([wave-8-closeout.md](wave-8-closeout.md)).

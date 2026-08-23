# Wave 3: Quiz (`v2.4.0`)

Parent: [overview.md](overview.md)

Depends on Wave 1. May run in parallel with Wave 2.

## Goal

Same framework as flashcards. A student runs a multiple-choice quiz generated from course digests, sees an explanation after each answer, and can refresh when notes change.

## Data structures

- `study/quiz.json` as in the [format spec](../../specs/2026-08-22-v3-study-artifacts-format.md)
- Question `id` = short hash of normalized `prompt` + `source.digest`
- `.arbor/progress/<course>.quiz.json`
- Setting `auto_generate.quiz` default `false`

## PRs

| PR | Work | Verify |
|----|------|--------|
| 3.1 | `skills/quiz.py` prompt, Pydantic pack, write + commit | FakeProvider generate. 10+ questions from a multi-digest fixture |
| 3.2 | Retry on invalid `answer_index` / missing choices | Bad JSON retries. Prior `quiz.json` untouched on final failure |
| 3.3 | Quiz UI. One question, four choices, explanation after submit | Empty state Generate. Existing pack plays |
| 3.4 | Refresh, stale badge, source chip → Notes | Same as flashcards |
| 3.5 | Settings `auto_generate.quiz` | Toggle queued after Update |

## Files

- Create: `python/src/arbor_worker/skills/quiz.py`
- Create: `python/tests/test_skills_quiz.py`
- Modify: settings, generate CLI, desktop quiz panel, Tauri read/write progress

## Verification

**Static.** pytest, cargo test, npm run build.

**Runtime.** 10+ question pack from a multi-digest course. Wrong answer shows explanation. Git commit `study: Biology quiz`. Ingest still works.

# Wave 1: Study artifact framework (`v2.2.0`)

Parent: [overview.md](overview.md)

## Goal

One pluggable skill path end to end, proven with a fixture skill, before flashcards. After this wave, `arbor-worker generate --skill fixture` against `FakeProvider` writes validated JSON, updates `study/manifest.json`, and can run as a desktop job.

## Data structures

- `StudySkill` protocol. `name`, `build_prompt`, `validate`, `run`
- `StudyManifest` plus per-artifact `content_sha256` of source digests
- Pydantic models under `python/src/arbor_worker/schemas/study/`
- Plan JSON `{ "course", "skill", "force" }`
- Events `skill_started`, `skill_progress`, `skill_done`, `skill_failed`, `skill_stale_skipped`

## PRs

| PR | Work | Verify |
|----|------|--------|
| 1.1 | Add `pydantic`. `StudySkill` protocol, fixture skill, JSON Schema files | Fixture `validate()` accepts a golden JSON blob and rejects a broken one |
| 1.2 | `json.loads` + Pydantic + 2 retries in `skills/base.py`. `FakeProvider` returns JSON in `markdown` | Bad JSON retries then succeeds. Third failure leaves prior file untouched |
| 1.3 | `study/manifest.py` load/save, SHA-256 staleness | Unchanged digests emit `skill_stale_skipped`. `--force` regenerates |
| 1.4 | `arbor-worker generate --root --course --skill [--force]` | CLI on a fixture Knowledge repo writes `study/` and commits |
| 1.5 | Events `skill_*`. `ensure_gitignored` for `.arbor/progress/` | JSONL log contains `skill_done` |
| 1.6 | Tauri `start_study_job`, `JobTrigger::Study`, mutex copy “A job is already running” | Second job while running returns that error |
| 1.7 | Desktop empty state. **Generate** still disabled for flashcards/quiz (wire in Waves 2–3). Inspector shows skill events | Coming soon badge gone. Empty state copy + disabled Generate |

## Files

- Create: `python/src/arbor_worker/skills/base.py`
- Create: `python/src/arbor_worker/skills/fixture.py`
- Create: `python/src/arbor_worker/skills/manifest.py`
- Create: `python/src/arbor_worker/schemas/study/`
- Create: `python/tests/test_skills_base.py`, `python/tests/test_generate.py`
- Modify: `python/pyproject.toml` (pydantic)
- Modify: `python/src/arbor_worker/cli.py`, `commands.py`, `events.py`
- Modify: `python/src/arbor_worker/cache.py` (`ensure_gitignored`)
- Modify: `desktop/src-tauri/src/commands.rs`, `jobs.rs`, `worker.rs`, `lib.rs`
- Modify: `desktop/index.html`, `desktop/src/main.ts`

## Settings

None yet. `auto_generate` lands with the real skills.

## Verification

**Static.** `uv run pytest -q` (new skill tests plus existing suite). `cargo test`. `npm run build`.

**Runtime.** `arbor-worker generate --root <tmp> --course Biology --skill fixture --provider fake`. `study/fixture.json` exists. `git log -1` message `study: Biology fixture`. Desktop. empty Flashcards panel, Generate visible and disabled, no crash if a study job is started from a debug command.

## Notes

Digest generate still has no retry loop. Do not “reuse” it. The retry helper is new and skill-only.

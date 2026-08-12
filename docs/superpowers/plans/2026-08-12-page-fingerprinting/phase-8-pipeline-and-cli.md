# Phase 8: Pipeline, CLI, and fingerprint persistence

Back-link: [overview.md](overview.md)

## Goal

Run confirmed ranges end-to-end: prepare window → create/patch/regenerate → resynthesize `course.md` → update fingerprints for successful pages → commit.

## Changes

- Modify `python/src/arbor_worker/pipeline.py` to iterate ranges (not a single start page), call digest_update actions, cancel at range boundaries, and update `sources` fingerprints only for completed work.
- Modify `windowing.py` if clipping must support arbitrary `[start,end]` rather than `start…EOF` only.
- Update `events.py` (+ tests) for range-aware progress (`ranges`, patch/regenerate events as needed).
- Update `commands.py` / `cli.py` plan JSON: `selections: [{ path, ranges: [[s,e], ...] }]` with empty/omitted ranges = full file; migrate off `start_page` in the same wave.
- Update `python/tests/test_pipeline.py`, `test_cli.py`, `test_events.py`, `test_windowing.py`.

## Data structures

- Plan file: `{ "selections": [ { "path": str, "ranges": [[int,int], ...] | null } ] }`
- Pipeline course batch still ends with full `course.md` synthesis (existing `course_synthesis.py`)

## Verification

**Static.** `cd python && uv run pytest -q tests/test_pipeline.py tests/test_cli.py tests/test_events.py tests/test_windowing.py`

**Runtime.** `plan-update` then `update --plan` on a temp Knowledge git repo; assert digests, `course.md`, manifest `sources`, and commit exist. Delete-after-digest on: source gone, fingerprints remain.

# Phase 8: Pipeline, CLI, and fingerprint persistence

Back-link: [overview.md](overview.md)

## Goal

Run confirmed ranges end-to-end: prepare window → create/patch/regenerate → resynthesize `course.md` → update fingerprints for successful pages → commit.

## Changes

- Modify `python/src/arbor_worker/pipeline.py` to iterate ranges (not a single start page), call digest_update actions, cancel at range boundaries, and update `sources` fingerprints only for completed work.
- Modify `windowing.py` to clip arbitrary `[start,end]` (today is start→EOF only).
- Fix digest records so `end_page` is the window end (today it is always the full `page_count`).
- When chunking mid-file windows, map chunk page labels to **absolute** source pages for `arbor-pages` markers (chunk plans today are relative to the clipped image list).
- Resolve `pptx_text` windowing: today start_page>1 is ignored and forced to 1. For ranged PPTX, force the image fallback path (or reject partial ranges on text-only extracts) so mid-deck ranges are real.
- Update `events.py` (+ tests) for range-aware progress (`ranges`, patch/regenerate events as needed).
- Update `commands.py` / `cli.py` plan JSON: `selections: [{ path, ranges: [[s,e], ...] }]` with empty/omitted ranges = full file; migrate off `start_page` in the same wave.
- Update `python/tests/test_pipeline.py`, `test_cli.py`, `test_events.py`, `test_windowing.py`.

## Data structures

- Plan file: `{ "selections": [ { "path": str, "ranges": [[int,int], ...] | null } ] }`
- Pipeline course batch still ends with full `course.md` synthesis (existing `course_synthesis.py`)
- `DigestRecord.start_page` / `end_page` must reflect the digested window for overlap classification in phase 7

## Verification

**Static.** `cd python && uv run pytest -q tests/test_pipeline.py tests/test_cli.py tests/test_events.py tests/test_windowing.py`

**Runtime.** `plan-update` then `update --plan` on a temp Knowledge git repo; assert digests, `course.md`, manifest `sources`, and commit exist. Delete-after-digest on: source gone, fingerprints remain.

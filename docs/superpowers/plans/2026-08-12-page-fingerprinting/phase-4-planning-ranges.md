# Phase 4: Planning uses ranges

Back-link: [overview.md](overview.md)

## Goal

Make `build_plan` / `apply_selections` speak ranges and fingerprint-based suggestions instead of a single start page.

## Changes

- Modify `python/src/arbor_worker/planning.py` so pending items carry `suggested_ranges`, `alignment_status`, and selections accept `ranges` (blank/empty → full file).
- Update `python/tests/test_planning.py` accordingly; remove or migrate start-page-only assertions in the same wave.
- Wire fingerprint + alignment into `build_plan` using manifest `sources` (phases 1–3).
- Keep `plan_to_dict` JSON shape documented for CLI/desktop consumers.

## Data structures

- `PendingSource`: add `suggested_ranges: list[PageRange]`, `alignment_status: AlignmentStatus` (drop or deprecate `suggested_start_page`)
- `SelectedSource`: `ranges: list[PageRange]` instead of `start_page`
- Selection map: `path → list[PageRange] | None` (`None`/empty means full ingest)

## Verification

**Static.** `cd python && uv run pytest -q tests/test_planning.py`

**Runtime.** Build a plan for a grown PDF with stored prefix fingerprints; assert one suggested range `N+1…end` and `clean_append` status.

# Phase 7: Patch vs full regenerate

Back-link: [overview.md](overview.md)

## Goal

When a confirmed range overlaps existing digest coverage, update those digests in place (section patch), or fully regenerate when the entire coverage changed or markers are missing.

## Changes

- Create `python/src/arbor_worker/digest_update.py` (name flexible) that, given a range and manifest records, classifies create vs patch vs regenerate targets.
- Implement section patch via provider call constrained to one marker block; full regenerate reuses marked digest generation from phase 6.
- Add focused tests (`python/tests/test_digest_update.py`) for: no overlap → create; partial overlap → patch; full coverage change → regenerate; missing markers → regenerate.
- Multi-digest overlap: each owning digest patched for its sub-range.

## Data structures

- `DigestAction`: discriminated union `create | patch | regenerate` with target `digest_file` and `PageRange`
- Record coverage derived from `start_page`/`end_page` (must become true window bounds once phase 8 fixes today’s always-`page_count` `end_page`), preferring marker-declared ranges when present

## Verification

**Static.** `cd python && uv run pytest -q tests/test_digest_update.py tests/test_page_markers.py`

**Runtime.** Fixture course with one marked digest covering 1–10; patch range 4–5; file diff touches only that block; Git-friendly surgical change.

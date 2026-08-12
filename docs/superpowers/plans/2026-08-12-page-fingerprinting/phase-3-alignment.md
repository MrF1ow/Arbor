# Phase 3: Content-first alignment

Back-link: [overview.md](overview.md)

## Goal

Compare stored fingerprint sequences to current ones and classify clean append, dirty ranges, or ambiguous.

## Changes

- Create `python/src/arbor_worker/alignment.py` with alignment + classification pure functions.
- Add `python/tests/test_alignment.py` for clean append, mid insert, mid edit, and ambiguous/duplicate-heavy cases.
- No planning or pipeline imports yet; keep this pure.

## Data structures

- `PageRange`: `start: int`, `end: int` (1-based inclusive)
- `AlignmentStatus`: `clean_append | changed | ambiguous | identical`
- `AlignmentResult`: `status`, `suggested_ranges: list[PageRange]`, `matched_fraction: float`

Confidence rule from spec: matched fraction of old pages `< 0.8` or multiple equally good alignments → `ambiguous`.

## Verification

**Static.** `cd python && uv run pytest -q tests/test_alignment.py`

**Runtime.** Table-driven cases in pytest are the runtime proof for this pure module (no UI surface).

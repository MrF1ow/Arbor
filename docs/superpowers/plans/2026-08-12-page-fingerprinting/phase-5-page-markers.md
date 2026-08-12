# Phase 5: Page marker parse and replace

Back-link: [overview.md](overview.md)

## Goal

Treat digest markdown as marker-bounded sections so patches can replace one range without rewriting unrelated sections.

## Changes

- Create `python/src/arbor_worker/page_markers.py` to find, validate, and replace `<!-- arbor-pages:X-Y -->` … `<!-- /arbor-pages:X-Y -->` blocks.
- Add `python/tests/test_page_markers.py` for happy path, missing markers, overlapping/malformed markers, and multi-block files.
- No LLM calls in this phase.

## Data structures

- Marker span: `PageRange` plus `body: str` offsets or extracted body text
- `PatchError` / result type distinguishing missing vs malformed vs ok

Exact delimiter format is locked in the spec.

## Verification

**Static.** `cd python && uv run pytest -q tests/test_page_markers.py`

**Runtime.** Round-trip a fixture markdown file: replace one block, assert sibling blocks unchanged.

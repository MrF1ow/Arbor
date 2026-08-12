# Phase 6: Marked digest generation

Back-link: [overview.md](overview.md)

## Goal

New digests always emit mandatory page markers so future overlaps are patchable.

## Changes

- Update digest prompt builders (under `digest.py` and/or chunk generate synthesis prompts) to require `arbor-pages` wrappers for the generated window.
- Ensure single-shot and chunked→final digest paths both produce marked markdown before write.
- Extend `python/tests/test_digest.py` / chunk generate tests with FakeProvider outputs that include markers; reject or repair path when markers missing (prefer fail-closed then regenerate policy deferred to phase 7).
- Touch only prompt/write helpers and their tests; leave pipeline orchestration for phase 8.

## Data structures

- Digest write payload remains markdown string; invariant: every created digest contains at least one valid marker pair covering the digested range.

## Verification

**Static.** `cd python && uv run pytest -q tests/test_digest.py tests/test_chunk_generate.py`

**Runtime.** FakeProvider generate for pages 2–3; written digest contains matching open/close markers for `2-3`.

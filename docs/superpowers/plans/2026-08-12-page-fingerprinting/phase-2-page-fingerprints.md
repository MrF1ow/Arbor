# Phase 2: Hybrid page fingerprints

Back-link: [overview.md](overview.md)

## Goal

Compute per-page fingerprints with the hybrid policy from the spec (local only; no provider calls).

## Changes

- Create `python/src/arbor_worker/page_fingerprints.py` (or equivalent single module) that fingerprints a PDF/PPTX path into an ordered list plus `fingerprint_kind`.
- Reuse prepare/render primitives where possible (`prepare/`, `probe.py`) instead of inventing a second render stack.
- Add `python/tests/test_page_fingerprints.py` covering PDF image kind, PPTX text-rich kind, and thin PPTX falling back to image kind (fake or tiny fixtures).
- Touch `hashing.py` only if a shared digest helper belongs there; keep page logic in the new module.

## Data structures

- `FingerprintKind`: `pdf_image | pptx_text | pptx_image`
- `PageFingerprintResult`: `kind`, `fingerprints: list[str]` (index `i` = page/slide `i+1`)

## Verification

**Static.** `cd python && uv run pytest -q tests/test_page_fingerprints.py tests/test_hashing.py`

**Runtime.** Fingerprint a small multi-page PDF fixture twice; identical hashes. Change one page’s bytes (or text on PPTX); only that index changes.

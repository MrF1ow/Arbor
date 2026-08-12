# Testing and docs

Back-link: [overview.md](overview.md)

## Goal

Cross-check the spec’s testing strategy, update user-facing docs, and define the manual desktop checklist.

## Changes

- Update `python/README.md` and root `README.md` for ranges, markers, and fingerprint behavior (unslop / technical-writing).
- Optionally add a short note in the course-centric design pointing forward to the page-fingerprinting spec (no rewrite of historical plans).
- Ensure CI-equivalent local commands from the overview are green after phases 1–9.

## Verification matrix (from spec)

| Case | Where proven |
|------|----------------|
| Hybrid fingerprint kinds | Phase 2 tests |
| Clean append / mid insert / mid edit / ambiguous | Phase 3–4 tests |
| Marker round-trip; missing → regenerate | Phases 5–7 |
| Create vs patch vs regenerate | Phase 7–8 |
| Manifest v1→v2 | Phase 1 + 8 |
| Delete-after-digest keeps fingerprints | Phase 8 pipeline test |
| Desktop ranges Confirm/Cancel | Phase 9 build + manual |

## Manual desktop checklist

1. Knowledge repo with one course mega-PDF already fingerprinted for pages 1–N.
2. Append pages; Update → review shows pre-selected `N+1…end`.
3. Confirm → new marked digest; `course.md` refreshed; commit created.
4. Edit a middle page; Update → suggested dirty range; Confirm → existing digest section patched; `git diff` limited to that section + manifest + `course.md`.
5. Cancel mid-multi-range run; completed ranges persist; remaining return next Update.
6. Ambiguous fixture (duplicate slides): no strong auto ranges; user must enter ranges.

## Project commands

```bash
cd python && uv run pytest -q
cd desktop/src-tauri && cargo test
cd desktop && npm run build
```

# Phase 1: Incomplete coverage stays pending

Back-link: [overview.md](overview.md)

## Goal

A source whose file hash matches a digest record but whose fingerprint list has empty slots is pending. Suggested ranges are those uncovered pages, not a silent skip and not a full-file ingest by default.

## Changes

- `course_manifest.py` `is_current`: hash match is enough when there is no `sources` entry (v1). When `sources` exists, every slot for `page_count` must be a non-empty fingerprint.
- `planning.py` `_suggest_ranges`: if stored fingerprints have holes, return merged uncovered page ranges with status `changed`.

## Data structures

`SourceFingerprintState.page_fingerprints` already uses `""` for untouched pages. No new type.

## Verification

Pytest: partial ingest of a 4-page PDF for pages 3–4, second `build_plan` pending with suggested `1-2`. Existing v1 hash-only fixtures stay not pending.

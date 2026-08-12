# Phase 1: Manifest v2 sources

Back-link: [overview.md](overview.md)

## Goal

Extend `arbor-course.json` so each source can store durable per-page fingerprint metadata without breaking v1 manifests.

## Changes

- Modify `python/src/arbor_worker/course_manifest.py` to load/save `version: 2`, a `sources` map, and optional `page_markers_version` on records.
- Modify `python/tests/test_course_manifest.py` for v1 load compatibility, empty `sources`, and round-trip of a source fingerprint entry.
- Do not compute fingerprints yet; storage and accessors only.

## Data structures

- `SourceFingerprintState`: `source_hash`, `page_count`, `fingerprint_kind`, `page_fingerprints: list[str]`, `updated_at`
- Manifest root: `{ version: 2, records: [...], sources: { rel_path: SourceFingerprintState } }`

## Verification

**Static.** `cd python && uv run pytest -q tests/test_course_manifest.py`

**Runtime.** Load a hand-written v1 JSON fixture and a v2 fixture via the manifest API; assert `sources` defaults empty on v1 and persists on save for v2.

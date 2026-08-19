# Phase 4: Resume page fingerprinting

Back-link: [overview.md](overview.md)

## Goal

Finish issue #21's incremental metadata by executing the existing plan, not by designing a third layout. After this wave, a successful ingest writes manifest version 2, a `sources` map with per-page fingerprints, and digests with `arbor-pages` markers.

## Changes

Rebase onto wave 1. Then, with exclusive file ownership:

- Parallel. [phase 2 fingerprints](../2026-08-12-page-fingerprinting/phase-2-page-fingerprints.md), [phase 3 alignment](../2026-08-12-page-fingerprinting/phase-3-alignment.md), [phase 5 markers](../2026-08-12-page-fingerprinting/phase-5-page-markers.md). New modules only.
- Parallel after those land. [phase 4 planning ranges](../2026-08-12-page-fingerprinting/phase-4-planning-ranges.md) and [phase 6 marked generate](../2026-08-12-page-fingerprinting/phase-6-marked-digest-generate.md). Phase 6 waits for program phase 3 (`digest.py`).
- Then [phase 7 patch](../2026-08-12-page-fingerprinting/phase-7-patch-and-regenerate.md).
- Then [phase 8 pipeline](../2026-08-12-page-fingerprinting/phase-8-pipeline-and-cli.md) **plus** [phase 5 of this program](phase-5-single-digest-course-index.md) in the same `pipeline.py` edit.
- Then [phase 9 desktop ranges](../2026-08-12-page-fingerprinting/phase-9-desktop-ranges-ui.md) after program phase 2 has landed.
- Then [testing.md](../2026-08-12-page-fingerprinting/testing.md).

Phase 1 of that plan (manifest `sources` API) is already on `main`. Do not redo it.

**Known hole the owner must close in fingerprinting phase 8.** `CourseManifest.set_source` exists. `pipeline.py` never calls it. `record()` still leaves `page_markers_version` unset. `end_page` is stored as full `page_count`. Those three facts are why generated libraries cannot suggest dirty ranges.

## Data structures

Owned by the 2026-08-12 spec. Do not invent a parallel schema.

- Manifest v2 `sources` map and `FingerprintKind`
- `PageRange` / plan `ranges: [[start, end], ...]`
- `<!-- arbor-pages:X-Y -->` marker pairs

## Verification

Per each existing phase file. Coordinator reads `git diff` after every phase. Do not advance on a self-report.

**Static after phase 8.** `cd python && uv run pytest -q`

**Runtime after phase 8.** Temp Knowledge git repo, one grown PDF, `plan-update` then `update --plan`. Assert `arbor-course.json` `"version": 2`, a non-empty `sources` entry, non-null `page_markers_version`, and markers in the digest file.

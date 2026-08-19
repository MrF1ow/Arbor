# Page Fingerprinting Implementation Plan

> **Status (2026-08-19):** Landed on `main` in **0.2.0** ([PR #22](https://github.com/MrF1ow/Arbor/pull/22)). Do not re-implement from this plan. Phase files stay as the original TDD recipes.
>
> **Playbook:** poteto-mode multi-phase plan (`references/plan.md`). Plan only. Do not implement from this document until the user starts execution.
>
> **Spec:** [../../specs/2026-08-12-page-fingerprinting-design.md](../../specs/2026-08-12-page-fingerprinting-design.md)

**Goal:** Detect dirty page ranges via hybrid fingerprints, drive range-based review, create marked digests for new coverage, and surgically patch existing digests so Git owns history.

## Context

Course-centric ingest (PR #7) uses whole-file hashes and a single optional start page. Mega-deck mid-edits and inserts are invisible as precise ranges. Stacking new dated digests for overlapping content forces `course.md` to reconcile duplicates. This work makes the course manifest the durable fingerprint store, suggests explicit ranges at plan time, and patches digest sections in place.

## Scope

**In**

- Manifest v2 `sources` map with per-page fingerprints
- Hybrid fingerprinting (PDF image; PPTX text or image)
- Content-first alignment with ambiguous fallback
- Plan/review `ranges` replacing start-page as the primary control
- Mandatory `arbor-pages` markers; section patch vs full regenerate
- Pipeline + CLI + desktop wiring
- Docs and tests

**Out**

- Production packaging / sidecar (macOS-first + Codex external stays a separate track)
- Settings UI for fingerprint knobs
- Silent Update without Confirm
- Fingerprint strategy refinement dogfood (human GitHub issue)
- Windows packaging

## Constraints

- Python 3.11+ worker, pytest, existing FakeProvider patterns under `python/`
- Tauri v2 desktop; plan file JSON between UI and worker
- Fingerprints must live in committed `arbor-course.json` (survive delete-after-digest)
- Chunked generate remains the engine for large windows
- Always full `course.md` resynthesis after a successful course batch
- Preserve cooperative cancel at range boundaries
- Known baseline sharp edges to fix in phase 8: `end_page` always equals full `page_count` today; windowing is start→EOF only; chunk page indexes are relative to the clipped list; `pptx_text` cannot window (must image-fallback or reject partial ranges)

## Alternatives

Already settled in the design spec (exhaust-the-design-space):

1. **Fingerprints in committed manifest + plan-time align** (chosen)
2. Fingerprints only in `_arbor_cache/` (rejected: voided by delete-after-digest)
3. Git-diff of binary sources (rejected: weak for PDF/PPTX; fails when sources deleted)

## Applicable skills

- **how** before changing unfamiliar subsystems (planning, pipeline, prepare, desktop review)
- **architect** when crossing worker↔desktop plan schema boundaries
- **tdd** / project pytest for each phase
- **unslop** / **technical-writing** for README and progress copy
- **show-me-your-work** if execution spans multiple PRs
- **interrogate** before shipping contested alignment/patch behavior
- Opening a PR / babysit after implementation PRs land

**Principles that shaped this plan**

- **foundational-thinking:** shared types (`PageRange`, `AlignmentResult`, manifest `sources`) land before pipeline behavior
- **model-the-domain:** ranges and alignment outcomes as types, not start-page special cases forever
- **redesign-from-first-principles:** treat ranges as the primary selection shape; migrate callers off start-page in one wave where the plan schema is concerned
- **sequence-verifiable-units:** nine small phases, each ending in tests
- **experience-first:** review panel stays Confirm-gated; clean append is one-click Confirm, not silent
- **prove-it-works:** worker pytest per phase; desktop cargo/npm build; note missing control-ui skill for Tauri
- **guard-the-context-window:** exploration delegated; plan keeps file pointers only

## Phases

1. [phase-1-manifest-v2-sources.md](phase-1-manifest-v2-sources.md) — Manifest `sources` map and v1→v2 load
2. [phase-2-page-fingerprints.md](phase-2-page-fingerprints.md) — Hybrid per-page fingerprint helpers
3. [phase-3-alignment.md](phase-3-alignment.md) — Content-first alignment and dirty ranges
4. [phase-4-planning-ranges.md](phase-4-planning-ranges.md) — Plan types and suggestions use ranges
5. [phase-5-page-markers.md](phase-5-page-markers.md) — Parse/replace `arbor-pages` markers
6. [phase-6-marked-digest-generate.md](phase-6-marked-digest-generate.md) — Create digests with mandatory markers
7. [phase-7-patch-and-regenerate.md](phase-7-patch-and-regenerate.md) — Overlap classify, section patch, full regenerate
8. [phase-8-pipeline-and-cli.md](phase-8-pipeline-and-cli.md) — Wire update path, events, plan JSON, fingerprint persistence
9. [phase-9-desktop-ranges-ui.md](phase-9-desktop-ranges-ui.md) — Review panel ranges + Tauri selections
10. [testing.md](testing.md) — Cross-phase verification matrix and docs

## Verification (project-level)

```bash
cd python && uv run pytest -q
cd desktop/src-tauri && cargo test
cd desktop && npm run build
```

Manual: run `arbor-worker plan-update` on a Knowledge fixture with a grown mega-PDF; confirm suggested ranges; Confirm through desktop review; inspect digests for markers and git diff on patched files.

**Surface gap:** no `control-ui` / `control-cli` skill is wired for this Tauri+worker stack in-repo. Flag manual desktop checklist in [testing.md](testing.md).

## Implementation guidance

Implementers must:

1. Read the **how** skill over `planning`, `pipeline`, `course_manifest`, and desktop `main.ts` before edits.
2. Keep each phase to its listed files; do not sneak desktop into early worker phases.
3. Prefer redesign of selection as `ranges` end-to-end; temporary dual `start_page` support only if a phase explicitly needs a one-step bridge, then delete it in the same delivery wave (**migrate-callers-then-delete-legacy-apis**).
4. Run `/deslop` before commit; **unslop** README/PR prose.
5. Use **show-me-your-work** if stacking multiple implementation PRs.
6. After opening an implementation PR, use the Babysit playbook (not Cursor’s built-in babysit skill).
7. **interrogate** alignment confidence and patch-vs-regen edge cases before calling the feature done.

## File map (implementer index)

| Area | Pointers |
|------|----------|
| Spec | `docs/superpowers/specs/2026-08-12-page-fingerprinting-design.md` |
| Manifest | `python/src/arbor_worker/course_manifest.py`, `python/tests/test_course_manifest.py` |
| Hashing / probe | `python/src/arbor_worker/hashing.py`, `probe.py`, `prepare/` |
| Planning | `python/src/arbor_worker/planning.py`, `python/tests/test_planning.py` |
| Pipeline | `python/src/arbor_worker/pipeline.py`, `windowing.py`, `digest_files.py`, `course_synthesis.py` |
| CLI | `python/src/arbor_worker/cli.py`, `commands.py`, `python/tests/test_cli.py` |
| Desktop | `desktop/src/main.ts`, `types.ts`, `desktop/src-tauri/src/commands.rs`, `worker.rs` |
| Events | `python/src/arbor_worker/events.py`, `python/tests/test_events.py` |

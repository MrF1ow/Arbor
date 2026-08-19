# Phase 2: Synthesis failure and course rules

Back-link: [overview.md](overview.md)

## Goal

A failed two-digest rollup still saves `arbor-course.json` and digest files, commits them, and writes a link-only `course.md` so the next Update does not create a second digest for the same window. Course rollup prompts include digest `_RULES`.

## Changes

- `pipeline.py` on `CourseSynthesisError`: write a TOC `course.md`, `manifest.save()`, still commit
- `course_synthesis.py`: `build_course_toc`; course prompt includes `_RULES` from `digest.py`

## Data structures

No new types. TOC is markdown links under `## Digests`.

## Verification

Pytest: existing synthesis-failure pipeline test expects manifest + one digest per source + TOC `course.md` + commit. Course prompt test asserts Source rules.

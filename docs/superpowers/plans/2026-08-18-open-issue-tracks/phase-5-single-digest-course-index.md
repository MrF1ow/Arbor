# Phase 5: Single-digest course index

Back-link: [overview.md](overview.md)

Land this in the same `pipeline.py` change as fingerprinting phase 8. Do not open a second pipeline PR.

## Goal

A course with one digest does not spend a Codex call to clone that digest into `course.md`. A course with two or more digests keeps today's LLM rollup.

## Changes

- Modify `python/src/arbor_worker/course_synthesis.py` to build a short local index when `len(digests) < 2`. Include the course name, a link to the dated digest file, and a short overview taken from that digest's Overview section when present. No provider call.
- Modify `python/src/arbor_worker/pipeline.py` so the existing synthesis step uses that helper. Two-or-more digests still call `synthesize_course` with the provider.
- Modify `python/tests/test_course_synthesis.py` (and pipeline coverage if the current tests assume a provider call on the first digest).

Issue #21 allowed omitting `course.md` until two digests exist. Callers today do not require the file (desktop only logs synthesis events). This plan still keeps a short **local** index so the course folder has an entry file. It must not use a Codex call. If that still feels noisy in review, switch to omit in this same pipeline edit. Do not LLM-summarize a single digest.

Do not rewrite the two-digest synthesis prompt in this phase unless it still emits LaTeX after phase 3. If it does, add the same formatting rules here (still these files only).

## Data structures

- Keep `synthesize_course(...)` for the multi-digest path.
- Add a pure `build_course_index(course_name: str, digests: list[tuple[str, str]]) -> str` for the one-digest path.

## Verification

**Static.** `cd python && uv run pytest -q tests/test_course_synthesis.py tests/test_pipeline.py`

**Runtime.** Ingest one PDF into a temp course. `course.md` is a short index and is not a near-copy of `digests/*.md`. FakeProvider call count for that course is zero for synthesis. Ingest a second source. `course.md` is provider-synthesized from both digests.

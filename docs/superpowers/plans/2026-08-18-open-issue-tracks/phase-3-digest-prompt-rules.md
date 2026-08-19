# Phase 3: Digest prompt rules

Back-link: [overview.md](overview.md)

## Goal

New digests stay source-grounded and readable in plain GitHub-flavored Markdown. Equations do not ship as LaTeX.

## Changes

- Modify `python/src/arbor_worker/digest.py` templates (`_TEMPLATE`, `_CHUNK_TEMPLATE`, `_SYNTHESIS_TEMPLATE`) with the source-boundary and formatting rules from issue #3. Same words in all three so chunk merge cannot reintroduce LaTeX.
- Modify `validate_digest` to reject `\\(`, `\\[`, and `\\frac`. That encodes the rule in the worker, not only in the prompt.
- Modify `python/tests/test_digest.py` to assert the rules appear in each builder and that validation rejects a LaTeX-shaped body.

Do not change `course_synthesis.py` here. Course-notebook formatting follows in phase 5 if still needed. Do not touch `pipeline.py`.

## Data structures

- No new types. Prompt strings and `DigestError` stay the contract.

## Verification

**Static.** `cd python && uv run pytest -q tests/test_digest.py tests/test_chunk_generate.py`

**Runtime.** `FakeProvider` path in `tests/test_pipeline.py` still passes. A live Codex digest is optional and not required to merge.

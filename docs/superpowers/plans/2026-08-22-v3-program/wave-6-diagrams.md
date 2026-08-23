# Wave 6: Diagram analysis (`v2.7.0`)

Parent: [overview.md](overview.md)

Spec: [knowledge layer](../../specs/2026-08-23-v3-knowledge-layer-design.md)

Depends on Wave 5. Figure nodes merge into `study/concepts.json`.

## Goal

Lecture figures become graph nodes. Prepare already renders page images. This skill reads those images (or digest figure captions) and merges `kind: figure` concepts. It does not re-ingest PDFs.

## Data structures

- Concept node with `"kind": "figure"`
- Source includes digest path and heading or page marker
- Same manifest staleness as other skills

## PRs

| PR | Work | Verify |
|----|------|--------|
| 6.1 | `skills/diagrams.py`. Prompt with image paths from prepare cache. Merge into concepts.json | FakeProvider returns a figure node. Merge keeps existing text concepts |
| 6.2 | Skip pages with no usable figure. Empty result is success | Fixture with no figures. `skill_done`, concepts file unchanged except timestamp |
| 6.3 | Desktop. Figure chips distinct from text concepts. Source opens Notes | Generate diagrams on a course that has a labeled figure in a digest |

## Files

- Create: `python/src/arbor_worker/skills/diagrams.py`
- Create: `python/tests/test_skills_diagrams.py`
- Modify: concepts merge helper, desktop chip styling

## Verification

**Static.** pytest, cargo test, npm run build.

**Runtime.** Course with a figure in a PDF digest. After generate, Graph shows a figure node linked to the topic. Ingest still works. No second copy of the PDF in git.

## Constraint

Do not add a parallel `figures.json`. The graph is the store.

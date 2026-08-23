# Wave 5: Graph, concepts and cross-document links (`v2.6.0`)

Parent: [overview.md](overview.md)

Spec: [knowledge layer](../../specs/2026-08-23-v3-knowledge-layer-design.md)

Depends on Wave 1. May start in parallel with Waves 2–4. Waves 6–7 wait on this.

## Goal

Each course has a committed concept graph. Notes shows related chips. A Graph panel lists a concept and its neighbors. Clicking a source opens the digest. This is the graph Version 4 will walk. It is not a decoration.

## Data structures

- `study/concepts.json` nodes + edges (schema in the knowledge-layer spec)
- Node `id` = slug of normalized `name`
- Edges carry `relation` and `sources[]`
- Manifest entry `concepts` with digest SHAs

## PRs

| PR | Work | Verify |
|----|------|--------|
| 5.1 | `skills/concepts.py` prompt, Pydantic graph, merge duplicate names, commit | FakeProvider. Two digests that share a term become one node with two sources |
| 5.2 | Stale badge + Refresh from digests | Same as flashcards |
| 5.3 | Notes chips for concepts whose `sources` include the open digest | Chip click highlights the neighbor list |
| 5.4 | Graph panel. List + neighbors. No canvas. Source click → Notes | Open glycolysis. See pyruvate. Open source digest |
| 5.5 | Generate / empty state on the Graph panel | First-time course can generate concepts without flashcards |

## Files

- Create: `python/src/arbor_worker/skills/concepts.py`
- Create: `python/tests/test_skills_concepts.py`
- Modify: desktop Notes pane, new Graph panel or mode tab, Tauri read `concepts.json`

## Verification

**Static.** pytest, cargo test, npm run build.

**Runtime.** Generate concepts for a two-digest course. A term used in both lectures is one node. Notes chips appear. Neighbor click opens the other digest. Git commit includes `study/concepts.json`.

## Out of this wave

Force-directed canvas. That stays out of Version 3. Diagrams and citation checks are Waves 6–7.

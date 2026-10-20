# PR 10: Graph (concepts)

Branch `ui/10-graph`, stacked on `ui/09-quiz`. Master plan §11 row 10, Appendix B item 6. Read `README.md` in this folder first: **no browser, never launch the app window, never run `dev:mock`.**

- **Design:** the mockup has no graph view. Legacy is a **list + detail** layout, not a drawn graph; keep that. Build it from the PR 7 Notes layout language:
  - a left list pane like the notes index (15rem, hairline right border, its own scroller, the 2px active bar on `ListRow`)
  - a reading-width detail pane (the serif title, `SectionLabel`s, and chips)
  - the artifact toolbar from `components/study/*` (stale / refresh)
- **Legacy reference:** `desktop/src/legacy/main.ts`, plus the markup in `desktop/legacy.html` (~206–232):

  | Legacy code | Line |
  |---|---|
  | `readConceptGraph` | ~1868 |
  | `renderConceptGraph` | ~1908 |
  | `loadGraph` | ~1966 |
  | `startConceptJob` / `startDiagramJob` | ~2020–2060 |
  | generate/refresh handlers | ~3755–3769 |
- **Pure logic:** `src/domain/concepts.ts`: `parseConceptGraph`, `neighbors`, `digestKey`, `notePathForStudyDigest`, `conceptJobArgs`, `diagramJobArgs`. **Reuse it.**

## Work directory
`/home/flow/Projects/personal/Arbor/.worktrees/ui-stack/desktop`

## 1. Route and data (`course.$course.graph.tsx` → `components/graph/graph-view.tsx`)
- **Keep the `concept` search param** (PR 7 concept chips send `?concept=<id>`). It's the selected node. Selecting a node updates it with `replace` navigation, so back/forward isn't spammed.
- **Data:**
  - `useStudyJson(root, course, "concepts.json")` parsed with `parseConceptGraph`. A parse error, a missing graph, or `graph.course !== course` all mean missing.
  - `useStudyArtifactStale(root, course, "concepts")`
  - `citations.json`
- **Selection:** the `concept` param if present in the graph, otherwise the first node. An unknown id falls back to the first node and replaces the param. Initialize during render, not in an effect (the PR 9 pattern; no empty-state flash).

## 2. Layout
- **Toolbar:** "{n} concepts", the stale line, **Refresh concepts** (force), and **Generate diagrams** / **Refresh diagrams** (diagram job, force false/true). Legacy had separate generate/refresh buttons for both; keep all four actions, laid out sensibly. A small "Diagrams" button group is fine.
- **List pane:** one `ListRow` per node.
  - Label: `Figure · {name}` for `kind === "figure"` (with a figure icon such as `Image` and the dashed figure-chip styling), otherwise the name.
  - **Unverified** nodes (`failedIdsFor(report, "study/concepts.json")`) get a faint "Unverified" marker or the badge, with the reason as a tooltip.
  - Below about 44rem of container width, the list becomes a `Sheet` opened by a "Concepts" button (the same pattern as the PR 7 narrow notes index).
- **Detail pane:**
  - **Title:** the serif name (with the `Figure ·` prefix for figures).
  - **Summary:** in the reading font.
  - **`SectionLabel` "Neighbors":** chips showing `{name} · {relation}` (from `neighbors(graph, id)`); clicking one selects that node. If there are none, show the faint text "No linked concepts."
  - **`SectionLabel` "Sources":** source chips (digest title · heading, via the PR 8 `formatFlashcardSourceLabel` helper, or a generalized `formatStudySourceLabel`) that go to the Notes digest with `heading`.
- **Empty state:** an `EmptyState` with `No concept graph yet for {course display name}. Generate concepts from your digests.`, primary **Generate concepts**, and secondary **Generate diagrams**.

## 3. Jobs (port `startConceptJob` / `startDiagramJob`)
- The same gates as PR 8/9: viewer block, "Select a model in Settings.", the auth gate → `signedOutJobMessage` to the log (the log never opens), and disabled while a job runs.
- Use `useStartConceptJobMutation` / `useStartDiagramJobMutation`.
- Log lines: `Concept job {id} started.` / `Concept generation failed to start: {error}`, and `Diagram job {id} started.` / `Diagram generation failed to start: {error}`.
- Extract the shared generate-gate logic (now used by Flashcards, Quiz, and Graph) into one hook, e.g. `useStudyJobLauncher(kind)`, if it isn't already shared. Keep the Flashcards/Quiz behavior identical; their tests must still pass.

## 4. Keyboard (scoped; the same guards as PR 8/9)
↑/↓ move the selection through the list (wrapping is off), and Enter on a focused neighbor chip activates it (native button behavior). Add the rows to the catalog under `group: "Graph"`.

## 5. Tests (vitest; delete `tests/concepts-ui.test.mjs`)
- The list renders every node, with figure and unverified styling plus the reason tooltip.
- Clicking a list row selects it and updates `?concept=` (replace).
- A neighbor chip selects that node.
- The source chip → the Notes digest route with `heading`.
- `?concept=` from a Notes concept chip (an end-to-end test from a digest chip click) lands on that node; an unknown id falls back to the first node.
- ↑/↓ change the selection; the keys are ignored while typing or with a dialog open.
- Empty state: the copy; Generate concepts / diagrams payloads (`conceptJobArgs`/`diagramJobArgs`, force false); refresh sends force true; signed-out / no-model / viewer / running-job gates.
- Stale line; course mismatch → empty; no empty-state flash on load.
- Flashcards and Quiz tests still pass after the job-launcher extraction.

## 6. Acceptance (run all, report real results)
- `npm test` (exit 0), `npm run lint`, `npm run build` (entry ≤ 250 KB; graph is code-split).
- **Needs visual check (Claude):**
  - graph at 700/1100/1600, light and dark
  - figure / unverified rows
  - the neighbors and sources chips
  - the narrow list sheet
  - the empty state

## Commit
Focused commits on `ui/10-graph`, each ending `Co-Authored-By: Composer 2.5 <noreply@cursor.com>`. Don't push. Don't create or link pull requests.

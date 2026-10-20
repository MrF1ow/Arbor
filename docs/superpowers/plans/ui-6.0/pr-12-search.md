# PR 12: Search (command palette)

Branch `ui/12-search`, stacked on `ui/11-chat`. Master plan §6.5, §11 row 12, Appendix B item 9. Read `README.md` in this folder first: **no browser, never launch the app window, never run `dev:mock`.**

- **What it replaces:** the legacy absolute-positioned search overlay. It becomes a **command palette**: the shadcn/Base UI `Command` (cmdk) inside a `Dialog`, opened with **Mod+K** or the header Search button (PR 5 already wires both to `search-placeholder-dialog.tsx`; replace that placeholder).
- **Legacy reference:** `desktop/src/legacy/main.ts`:
  - `runSearch` ~2646
  - the search handlers ~3283–3305 (250 ms debounce, semantic checkbox re-runs, click-outside closes)
  - `desktop/legacy.html` ~67–78
  - `src/domain/search-hit.ts` (legacy DOM renderer; replace it with a React row and keep the label logic as a pure helper)
- **Data:** `useSearch` / `useSemanticSearch` already exist in `src/lib/queries/search.ts` (limit 20). `SearchHit` = `{ course, path, kind, title, snippet, page_range, source_path }`. There is **no heading field**, so results open the digest at the top, as legacy did. Don't invent heading scrolling.

## Work directory
`/home/flow/Projects/personal/Arbor/.worktrees/ui-stack/desktop`

## 1. Palette (`components/app/search-palette.tsx`, lazy-loaded, out of the entry chunk)
- **Dialog:** top-anchored, about 40rem wide.
- **`Command` input** with placeholder "Search digests…", plus a **Semantic** `Switch` (label "Semantic") in the input row, legacy `search-semantic`. Persist the semantic preference in `ui-store`.
- **Query:**
  - debounce the input by **250 ms** (legacy) before querying
  - text mode → `useSearch`; semantic → `useSemanticSearch`
  - toggling semantic re-runs immediately with the current query
  - turn off cmdk's built-in filtering (`shouldFilter={false}`); results come from the worker
- **States:**
  - empty input → "Type to search digests" (legacy copy)
  - loading → a small spinner row
  - no hits → "No results" (legacy copy)
  - error → the destructive error text
  - no knowledge root → "Choose a Knowledge folder first." (the palette still opens)
- **Rows:** one `CommandItem` per hit, value = a unique `${course}:${path}`.
  - line 1: the **title** (medium)
  - line 2 (faint, `text-2xs`): `{course display name} · {path}{ · p.{page_range}}` (the legacy `sub` line, with the display name instead of the slug); a pure helper `searchHitMeta(hit)` in `domain/search-hit.ts`, unit-tested
  - line 3: the **snippet**, muted, clamped to 2 lines (`line-clamp-2`)
  - a `kind` badge (e.g. digest / plan) when `kind !== "digest"`
  - group the rows by course with `CommandGroup` headings when the hits span more than one course
- **Keyboard:** ↑/↓ move, Enter opens, Escape closes (cmdk and Dialog defaults). Opening focuses the input and selects any existing text.
- **Open a result:** close the palette. Resolve the path as legacy did: `rel = hit.path.includes("/") ? hit.path : `${hit.course}/${hit.path}``.
  - If it's a digest (`…/digests/<file>.md`) → navigate to `/course/$course/notes/$digest` (via `resolveDigestSlug`).
  - If it's `course.md` → the Overview.
  - `study/plan.md` → the Overview (the plan section).
  - Anything else → the Overview, plus `toast.info("Opened {course}")`.
  - If the hit's course is in another knowledge root (not possible today; search is per active root), ignore it.
- **Root switch:** clear the query and results (key the palette's state by the active root).
- **Mod+K** toggles the palette from anywhere, including while typing in an input (PR 5 rule). It's already in the shortcut catalog; keep it there.

## 2. Remove the old pieces
- Delete `search-placeholder-dialog.tsx` and point the header button and shortcut at the new palette.
- Delete the DOM-building `renderSearchHit` (legacy only) once `src/legacy` no longer needs it. **Legacy still imports it until cutover, so keep the legacy copy in `src/legacy` or leave the function in place** — don't break `legacy.html`. Add the new pure helpers next to it.

## 3. Mock data
Make `search_knowledge` / `search_semantic` in `src/test/mock-handlers.ts` return realistic hits that depend on the query:
- 3–5 hits across 2 courses
- one hit with `page_range`
- one with `kind: "plan"`
- semantic returns a different order or set
- an empty query returns `[]`
- the query "zzz" returns no hits

## 4. Tests (vitest)
- **Mod+K** opens the palette (and while focused in an input); the header button opens it; Escape closes it.
- **Debounce:** typing quickly makes **one** `search_knowledge` call after 250 ms with `{ root, query, limit: 20 }` (fake timers).
- **Semantic toggle:** `search_semantic` with the same args; re-runs on toggle without retyping; the preference persists.
- **States:** the empty, no-results, and no-root copy.
- **Row content:** title, meta line (display name, path, page), snippet; grouped by course when there are multiple courses.
- **Open:** Enter on a digest hit → closes and navigates to the digest route; a `course.md` hit → the Overview; mouse click works too.
- **Root switch** clears the palette state.
- **Bundle:** the palette isn't in the entry chunk (assert via the build output in the report).
- Pure helper tests for `searchHitMeta` and the path → route resolver.

## 5. Acceptance (run all, report real results)
- `npm test` (exit 0), `npm run lint`, `npm run build` (entry ≤ 250 KB; the palette is a lazy chunk).
- **Needs visual check (Claude):**
  - the palette at 700/1100/1600, light and dark
  - result rows with snippets
  - grouping
  - the empty and no-results states
  - the semantic switch
  - keyboard highlight

## Commit
Focused commits on `ui/12-search`, each ending `Co-Authored-By: Composer 2.5 <noreply@cursor.com>`. Don't push. Don't create or link pull requests.

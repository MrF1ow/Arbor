# PR 7: Notes, the Overview landing, and the reading pane

Branch `ui/07-notes`, stacked on `ui/06-welcome-library`. Master plan §4.3–4.4, §6.6, §6.7, §8 (markdown), §11 row 7, Appendix B item 3, and decision D9. **D10 is settled as "flags only"**: the course map shows `new`/`weak` flags, with no per-digest percentages and no worker change. Read `README.md` in this folder first: **no browser, never launch the app window, never run `dev:mock`.**

- **Design reference:** `docs/design/2026-10-18-ui-arbor-paper.html`. **Read its source**: `section.view.notes`, `nav.index`, `article.doc-overview`, `article.doc-digest`, and the `.stats`/`.next`/`.units`/`.callout`/`.eyebrow`/`.lede` CSS.
- **Legacy reference:** `desktop/src/legacy/main.ts`:

  | Legacy function | Line |
  |---|---|
  | `scrollNotesToHeading` | ~1212 |
  | the make-card selection helpers | ~1223–1345 |
  | `loadStudyPlan` | ~1349 |
  | `loadCourseOverview` | ~1385 |
  | `renderStudyRecommendations` | ~1402 |
  | `renderWeakTopics` | ~1463 |
  | `loadDigestPreview` | ~1497 |
  | `loadCourseContent` | ~1571 |
  | `renderNotesConceptChips` | ~1882 |
  | the study-plan generate handler | ~3804 |
  | `explainWeakestBtn` | ~3845 |
  | the make-card handlers | ~3858–3925 |

## Work directory
`/home/flow/Projects/personal/Arbor/.worktrees/ui-stack/desktop`

## 1. Routes
- **New layout route `course.$course.notes.tsx`:** the notes index pane on the left and `<Outlet/>` (the reading pane) on the right. `notes.index.tsx` (Overview) and `notes.$digest.tsx` render inside it.
- **`$digest` param:** the digest file stem (e.g. `2026-09-12-membranes`). It maps to `${course}/digests/${digest}.md`. Put the helpers in `domain/notes.ts`:
  - `digestSlugFromPath`
  - `digestNotesPath`
  - reuse `notePathForStudyDigest` / `digestKey` from `domain/concepts.ts` where they fit

  Unit-test them.
- **Optional search param `heading`** (validated as a string) on both routes. After content renders, scroll to `headingId(heading)` inside the reading pane, or to the top when there's no heading or no match. PR 12 search and the recommendation links use this.
- **Keep the PR 6 zero-digest `EmptyState` (Add files)** on the Overview.

## 2. Notes index pane (`components/app/notes-index.tsx`), §6.7
- Width about 15rem with a hairline right border, matching the mockup's `nav.index`.
  - It contains a `SectionLabel` "Course" with an `IconButton` (`ListCollapse` or `PanelLeftClose`, label "Hide index") that sets `ui-store.notesIndexOpen=false`.
  - Below that: the **Overview** row (`House` icon, title "Overview", sub-line "Study plan · course map") → `/course/$course/notes`.
  - Then `SectionLabel` "Digests" and a `ListRow` per digest from `useDigests`: title, with a faint sub-line showing the date. Rows link to `/course/$course/notes/$digest`.
- **Ordering:** keep the order `list_digests` returns, which is what legacy did. Don't re-sort.
- **Active row:** the 2px olive bar (existing `ListRow` active state), with `aria-current="page"`.
- **Hidden index:** the reading pane shows a small `IconButton` (label "Show index") at its top-left to bring it back. The reading column then centers at `--reading-max`.
- **Small screens:** below `@container` ~44rem (the main column, not the viewport), the index is hidden by default and opens as an overlay `Sheet` from the same button. Don't persist that narrow-mode open state.
- Virtualize with `@tanstack/react-virtual` when there are more than 100 digests; a plain list otherwise.

## 3. Overview (`notes.index.tsx` → `components/notes/course-overview.tsx`), §6.6
One reading-width column (`--reading-max`, centered), with the serif reading type. Top to bottom:
1. **Eyebrow and title:**
   - eyebrow: `House` icon and "Course overview"
   - title: the course display name, serif `h2`
   - lede: the **first paragraph** of `course.md`, a plain-text pure helper `firstParagraph(markdown)` in `domain/notes.ts`, unit-tested. Omit the lede when `course.md` is missing.
2. **Stat strip:** up to 3 tiles in the mockup's `.stats` style, each omitted when its data doesn't exist.
   - **Cards due today:** `overview.due.count`, with "of {deck_count}" small. Omit when `deck_count === 0`.
   - **Quiz accuracy:** from `read_quiz_progress` (`useQuizProgress`). The shape is `{ [questionId]: { seen, correct, wrong } }`, and accuracy is Σcorrect / (Σcorrect + Σwrong), rounded, with "{n} answers" small. Pure helper `quizAccuracy(progress)` (handles empty/invalid input), unit-tested. Omit it when there are no answers.
   - **Exam:** parse `Exam date: YYYY-MM-DD` from the study plan markdown (the worker writes exactly that line; see `python/src/arbor_worker/study_plan.py` `_insert_exam_date_line`). Show the days remaining, with "days away" small, "today" when 0, and omit it once the date has passed. Pure helpers `examDateFromPlan(md)` and `daysUntil(date, now)`, unit-tested.
3. **Next actions:** buttons at size `lg` (38px).
   - **Review N due cards:** primary, `Layers` icon. Goes to `/course/$course/flashcards`. Shown only when `due.count > 0`.
   - **Explain weakest topic:** outline, `GraduationCap` icon. Enabled only when `recommend.items` has a `weakest_topic` item, as in legacy. It navigates to `/course/$course/chat` with search params `{ mode: "explain", prompt: "Explain the weakest topic \"<label>\". Stay inside this course and cite sources." }`. The legacy prompt is verbatim; PR 11 (Chat) consumes these params and auto-sends. Add the search-param validation to the chat placeholder route now, so the link is type-safe.
4. **Course map:** `h3` "Course map", then a list in the mockup's `.units` style, one row per digest in the same order as the index.
   - Each row shows the number (its position, zero-padded, as in the mockup), the title, the date as the faint sub-line, and on the right an optional flag.
   - **Flags (D10, flags only):**
     - `weak`: a `text-destructive`-toned chip when any `overview.weak.topics[].digest` maps to this digest
     - `new`: a plain chip when a `recommend.items[]` of kind `unreviewed_digest` maps to this digest
     - pure helper `digestFlags(overview, digests)`, unit-tested, using `digestKey` for the matching
   - Clicking a row opens that digest.
5. **Exam focus callout** (mockup `.callout`, `Info` icon): shown only when there is a weakest topic or an unreviewed digest. Copy is built by a pure helper, e.g. "Exam focus: {weak label} is your weakest topic" plus, if any, " and {digest title} hasn't been reviewed yet." Unit-test it.
6. **Recommendations and weak topics** (legacy parity): `h3` "Recommended", then `Chip`/link buttons per `recommend.items`, mirroring the legacy `renderStudyRecommendations` routing:
   - `due_cards` → flashcards
   - `weakest_topic` / `unreviewed_digest` with a digest → that digest with `heading`

   Then `h3` "Weak topics", with one link per `weak.topics` entry that has a digest → that digest plus `heading`. Use the legacy empty copy ("No recommendations yet." / "No weak topics yet.") and error copy ("Could not load recommendations." / "Could not load weak topics.").
7. **Study plan:** `h3` "Study plan".
   - Render `study/plan.md` with `renderMarkdown` in `.prose-arbor`, or "No study plan yet." when it's missing.
   - Controls: a date `Input` (type `date`, label "Exam date", prefilled from `examDateFromPlan`) and a **Generate**/**Regenerate** button (the label depends on whether a plan exists).
   - **Port the legacy handler (~3804):**
     - viewer write-block
     - "Select a model in Settings." when there's no model
     - the auth gate through `fetchAuthStatus`, with the `signedOutJobMessage` copy
     - the status "Generating study plan…" while running
     - errors shown inline
     - uses `useStudyPlanMutation` with `{ provider, model, examDate: value || null }`
8. **Course notes:** the full `course.md` rendered in `.prose-arbor` under `h3` "Course notes", so no content is lost vs legacy (legacy showed `course.md` as the Overview body).

Before the overview reads, call `studyWrites.flush(3000)` once per mount, like legacy (~1561), so pending grades are reflected. Use the existing study-writes provider API; if there's no `flush`, add a thin wrapper.

**Loading and errors:**
- Each section has a `Skeleton` while loading.
- An overview failure logs `Could not load course overview: …` to the job log (as legacy did). It doesn't open the log, and the dependent sections show their error copy.

## 4. Digest reading pane (`notes.$digest.tsx` → `components/notes/digest-view.tsx`)
- `useMarkdown(root, digestNotesPath)`, rendered through `renderMarkdown`. Use the query `select` or `useMemo` keyed on the content so it doesn't re-render per keystroke; follow master plan §8. Inject the result into an `<article className="prose-arbor">` at reading width.
- **Eyebrow:** `FileText` icon plus the digest date from `useDigests`.
- **Chips row:**
  - the page chip ("Pages {pageChip}", plain `Chip` with `data-arbor-page` set to `pageChipRange` when present)
  - one concept `Chip` per `nodesForDigest(graph, path)` from `read_study_json concepts.json` (`useStudyJson`, parsed with `parseConceptGraph`; a missing graph shows no chips). Figure nodes get the figure style. Clicking a chip navigates to `/course/$course/graph` with search `{ concept: id }`; add that validation to the graph placeholder route for PR 10.

  The legacy page chip was prepended inside the article; here it lives in the chips row above the title, as in the mockup.
- **Error copy:** "Could not load file: {error}". For a missing `course.md` on the Overview, use "No notes yet. Add lecture files, then Update knowledge."
- **In-note digest links:** intercept clicks on `a[data-arbor-digest]` inside the article with one delegated `onClick` on the article, not per-anchor listeners. `preventDefault`, then navigate to that digest's route. Check `renderMarkdown`/`arborDigestTarget` for the attribute value.
- **Heading scroll:** per §1.

## 5. Make card (selection → dialog → `append_card`)
- **Selection tracking:** while a digest is open, a `selectionchange` listener (one effect, cleaned up) computes a snapshot when the selection is non-collapsed and inside the article:
  - text: collapsed whitespace, capped at 2000
  - the nearest `h1–h3` heading
  - the `data-arbor-page` ancestor
  - the digest path (`digests/<file>.md`)

  Port `collapseSelectionText`, `headingForSelectionNode`, and `pageForSelectionNode` as **pure functions in `domain/notes.ts`** that take the node and the article root. Unit-test them with happy-dom DOM fragments.
- **Make card button:** a small toolbar above the article, right-aligned on the chips row (mockup-consistent), holding a **Make card** outline button (`Plus` or `SquarePlus`, size sm).
  - It's enabled only while there is a snapshot. Keep the snapshot when the button takes focus, using `onMouseDown` `preventDefault` as legacy did.
  - The viewer write-block disables it with the viewer hint.
- **Dialog** ("Make card", serif title):
  - Front and Back `Textarea`s prefilled with the selection
  - a faint citation line: `digest · heading · p. page`
  - Cancel and Save
  - empty front or back → inline "Front and back are required."
  - Save calls `useAppendCardMutation` with `{ front, back, digest, heading, page }`; on success it closes and navigates to `/course/$course/flashcards` with search `{ card: id }` (PR 8 focuses it; add the search validation to the flashcards placeholder route); on error the message shows inline
  - lazy-load the dialog module so it stays out of the entry chunk

## 6. Carry-over shell fix (found in the PR 6 audit)
Below `md`, the mobile sidebar `Sheet` currently opens **by itself** whenever the persisted desktop `sidebarOpen` is true. Shrinking the window to 700px pops an overlay with a backdrop over the content.
- **Fix:** keep a separate, non-persisted `mobileSidebarOpen` (default `false`). On mobile, the header trigger and `Mod+B` toggle that state; on desktop they toggle the persisted `sidebarOpen`. Clicking a course in the sheet closes it.
- **Test:** with `sidebarOpen: true` persisted and a mobile viewport, no sheet or dialog is rendered until the trigger is clicked.

## 7. Tests (vitest + `renderWithProviders` + mockIPC fixtures; extend fixtures as needed)
- **Overview:**
  - the stat tiles render from fixtures, and are omitted when data is missing (no deck, no quiz answers, no plan)
  - Review N due cards → flashcards
  - Explain weakest topic → the chat route with the exact legacy prompt
  - course map rows with `weak`/`new` flags from the payload
  - the callout copy
  - a recommendation click → the digest route with `heading`
  - study plan Generate: the auth gate blocks when signed out; otherwise `study_plan` is called with the `examDate`; viewer blocked
  - **one** `study_progress` overview call per mount (assert the call count)
- **Index:**
  - Overview row first, then digests in fixture order
  - the active bar and `aria-current` follow the route
  - hide/show persists `notesIndexOpen`
- **Digest:**
  - the markdown renders
  - the page chip
  - concept chips (click → graph route with `concept`)
  - an in-note `data-arbor-digest` link navigates
  - the error copy on failure
- **Make card:**
  - a programmatic selection inside the article enables the button
  - Save sends `append_card` with `heading`/`page`/`digest`, then navigates to flashcards with `card`
  - empty fields → the required error
  - viewer blocked
- **Pure helpers:** `domain/notes.test.ts` for everything listed above.
- **Opening a course** from the sidebar still lands on the Overview, never a digest (D9 regression).

## 8. Acceptance (run all, report real results)
- `npm test`, `npm run lint`, `npm run build`. Report the entry gzip; the budget is 250 KB. The Notes view may be in the main chunk (§8), but the make-card dialog is lazy.
- No new `style-allow` without a reason in the report.
- **Needs visual check (Claude):**
  - the Overview vs the mockup at 700/1100/1600, light and dark
  - the index shown and hidden
  - a digest with chips and a page chip
  - the make-card dialog
  - heading scroll
  - the mobile sidebar no longer self-opening

## Commit
Focused commits on `ui/07-notes`, each ending `Co-Authored-By: Composer 2.5 <noreply@cursor.com>`. Don't push.

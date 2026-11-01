# UI rebuild: React + Tailwind + Base UI, modeled on T3 Code

Status: **decisions recorded 2026-10-18; design direction chosen (Arbor Paper); rebased on 0.5.2 and updated for the #97 performance work (2026-10-19)**. Target release: **0.6.0**. Scope: `desktop/` frontend only. The Rust side (`src-tauri`) and the Python worker don't change.

Reference: [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) `apps/web` (MIT). We copy its **structure and conventions**, not its files. Components come from the shadcn CLI using the same Base UI style T3 Code uses. That way the code is ours, not a vendored fork.

---

## 1. Why (summary of the investigation)

The current frontend is vanilla TS: one 4,347-line `main.ts` (as of 0.5.2), a static 555-line `index.html`, and one 1,890-line `styles.css`.

- **No design system.** Only colors are tokens. There are 40 distinct paddings, 41 margins, 16 font sizes (including `11.5px`), and 8 radii. Equal-looking things are built from different numbers.
- **Duplicated components.**
  - 3 dialogs each restyled from scratch.
  - 5 list-row variants.
  - 14 context-scoped input rules.
  - 9 unrelated button styles.
  - 3 copies of the 11px uppercase label.
- **Icons are Unicode glyphs** (`⌕ ⚙ ◎ ▭ ▴ ✓ 🗑` …). Font metrics differ per glyph and per OS, so they can't be centered reliably.
- **Theme bugs.**
  - The dark palette is written twice.
  - `.auth-badge.bad` has a light background in dark mode.
  - `.status-running` and the dialog backdrops use raw colors.
- **The shell is fixed.**
  - The sidebar is fixed at 220px with no collapse, and the index pane is fixed at 240px.
  - There are no responsive rules.
  - `logLine()` (74 call sites) calls `openInspector()`, so the log opens itself on any activity and never stays closed.
  - The footer mixes the course actions with the log, so the log can't be hidden on its own.
- **No components in code.** There are 71 manual `.hidden =` toggles and 61 module-level `let` state variables in `main.ts`.
- **16 of 25 desktop test files regex-match the text of `main.ts` / `index.html`** (0.5.2 added `issue-97-phase4.test.mjs` in the same style). They break on any restructuring.

## 2. Target stack

| Concern | Choice | Same as T3 Code? | Notes |
|---|---|---|---|
| View layer | **React 19** + **React Compiler** (`babel-plugin-react-compiler` via `@vitejs/plugin-react`) | yes | The compiler handles memoization, so no hand-written `useMemo`/`memo` |
| Styling | **Tailwind CSS v4** (`@tailwindcss/vite`), tokens in `@theme` | yes | `index.css` is the only place raw values live |
| Primitives | **Base UI** (`@base-ui/react`) through the **shadcn CLI**, style **`base-mira`**, plus the **`@coss`** registry (`https://coss.com/ui/r/{name}.json`) | yes (same `components.json`) | Components are copied into `src/components/ui/`, so we own them. T3 Code splits shared class strings into files like `dialog-styles.ts`; we do the same |
| Variants | `class-variance-authority` + `tailwind-merge` + `cn()` | yes | |
| Icons | `lucide-react` | yes | No Unicode glyphs anywhere |
| UI state | `zustand` (+ `persist` to `localStorage`) | yes | One small store per surface |
| Worker data | **`@tanstack/react-query`** wrapping Tauri `invoke` | no (T3 uses Effect atoms) | Gives caching, loading/error states, and invalidation on Tauri events. A lighter fit than Effect for Arbor |
| Routing | **`@tanstack/react-router`**, file-based routes via `@tanstack/router-plugin/vite` (`autoCodeSplitting: true`), **hash history** | yes (identical setup) | Typed routes for place, course, and mode, with back/forward. Each route file is split out automatically |
| Long lists | `@tanstack/react-virtual` | T3 uses `@legendapp/list` | For the log drawer, the digest list, and job history |
| Tests | `vitest` + `@testing-library/react` + `happy-dom`; `@tauri-apps/api/mocks` (`mockIPC`) | yes (vitest) | Playwright for screenshots (§9) |

**Runtime compatibility.** Tailwind v4 needs WebKit ≥ Safari 16.4 (it uses `@property`, `color-mix()`, and cascade layers).
- Linux: the dev box has WebKitGTK 2.54.1. ✓
- Windows: WebView2 is Chromium. ✓
- macOS: WKWebView uses the system WebKit, so macOS 13.3 or later (or Safari 16.4 installed on an older version). See decision D5.

**CSP.** `tauri.conf.json` already allows `style-src 'self' 'unsafe-inline'`, which Base UI positioning and React `style` props need. `script-src 'self'` stays as is. Nothing else changes.

## 3. Target layout of `desktop/src`

```
desktop/
  index.html                     # <div id="root">, loads src/main.tsx
  legacy.html                    # old UI, kept in dev only for side-by-side comparison, deleted at cutover
  components.json                # shadcn config (base style, lucide, aliases ~/components, ~/lib)
  src/
    main.tsx                     # createRoot, providers, router
    index.css                    # Tailwind import + @theme tokens + light/dark palettes + prose-arbor (ONLY raw values)
    lib/
      utils.ts                   # cn()
      ipc.ts                     # typed invoke/listen wrappers (built on existing tauri.ts)
      queries/                   # react-query hooks per domain: library.ts, notes.ts, study.ts, settings.ts, sync.ts, jobs.ts, skills.ts, workers.ts, chat.ts
      events.ts                  # one subscription to arbor://progress, job-finished, files-changed → stores + query invalidation
      shortcuts.ts               # global keybindings table
    stores/
      ui-store.ts                # sidebar mode, log open/height, notes index open, theme (persisted)
      job-store.ts               # active job, status, log ring buffer, unread count
      selection-store.ts         # make-card selection snapshot, focused card
    components/
      ui/                        # shadcn/Base UI primitives (button, dialog, sidebar, …) — generic, no Arbor logic
      app/                       # Arbor composites: AppShell, AppSidebar, CourseHeader, ActionBar, LogDrawer, StatusPill, PageHeader, SettingsSection, SettingRow, EmptyState
    routes/                      # file-based, T3 Code naming: __root.tsx, welcome.tsx, _course.tsx (layout: header + action bar),
                                 # _course.$course.notes.index.tsx (Overview, the landing page), _course.$course.notes.$digest.tsx,
                                 # _course.$course.flashcards/quiz/graph/chat.tsx, jobs.tsx, settings.tsx (layout),
                                 # settings.general.tsx, settings.appearance.tsx, settings.providers.tsx, settings.library.tsx,
                                 # settings.sync.tsx, settings.skills.tsx, settings.workers.tsx, settings.keybindings.tsx, dev.ui.tsx (dev only)
    routeTree.gen.ts             # generated by the router plugin
    features/
      notes/  flashcards/  quiz/  graph/  chat/  jobs/  settings/  library/  sync/  search/
                                 # each: components + hooks for that feature
    domain/                      # EXISTING pure modules moved here unchanged:
                                 # chat.ts citations.ts concepts.ts flashcards.ts quiz.ts markdown.ts
                                 # provider.ts library-role.ts search-hit.ts theme.ts types.ts tauri.ts
    test/
      setup.ts  mock-ipc.ts  fixtures/
```

Rules:
- `components/ui` knows nothing about Arbor.
- `features/*` may use `ui`, `app`, `lib`, `stores`, and `domain`, but never another feature's internals.
- `domain/` has no React and no DOM.

## 4. Design tokens (`src/index.css`)

Same shape as T3 Code: raw palette variables on `:root` / `.dark`, mapped into Tailwind with `@theme inline`.

**Chosen direction: Arbor Paper** (PR 2a). Reference mockup: `docs/design/2026-10-18-ui-arbor-paper.html`; the rejected directions are kept in `docs/design/2026-10-18-ui-directions.html`. In short:
- **Paper's** warm surfaces, hairlines, and serif reading.
- **The logo's colors:** the olive green of the canopy and the bark brown of the trunk.
- **Tool neutral's** lucide icons, including icons in the mode tabs.

### 4.1 Colors (Arbor Paper)

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--background` | `#F6F1E7` | `#1A1714` | warm paper |
| `--foreground` | `#2B2420` | `#ECE3D6` | bark-brown ink |
| `--card` / `--popover` | `#FBF8F1` | `#211D19` | cards, dialogs, flashcards, stat tiles |
| `--sidebar` | `#F3EDE1` | `#171411` | |
| `--muted` (hover) | `#EDE6D8` | `#25201B` | row and button hover |
| `--muted-foreground` | `#75695E` | `#ADA08F` | |
| `--faint-foreground` | `#A3978A` | `#7D7266` | metadata, italic section labels |
| `--primary` | `#586D37` | `#9DB46F` | **logo olive**. Buttons, active underline and row bar, links |
| `--primary-hover` | `#4A5D2D` | `#AEC383` | |
| `--primary-foreground` | `#FFFFFF` | `#171411` | |
| `--accent` / `--accent-foreground` | `#E8EAD8` / `#46562B` | `#272B1E` / `#B9CC8E` | olive tint: status pill, chip hover, chip text |
| `--selected` | `#E8E2CF` | `#2B2620` | selected rows where a fill is needed (dialogs, lists) |
| `--border` / `--input` | `#E2D8C8` | `#332D27` | hairlines |
| `--ring` | `var(--primary)` | same | focus ring |
| `--success` | `var(--primary)` | same | |
| `--destructive` | `#B03A2E` | `#E2806F` | "Again", weak topics, errors |
| `--destructive-surface` | `color-mix(in srgb, var(--destructive) 10%, transparent)` | same | fixes the old `#F5E8E5` dark-mode bug |
| `--info` | `#4A6F86` | `#8DB1C7` | running jobs |
| `--backdrop` | `rgb(43 36 32 / 0.35)` | `rgb(0 0 0 / 0.5)` | dialog backdrop |

Logos: `desktop/src/assets/arbor-mark.png` (light) and `arbor-mark-dark.png` (dark), switched by theme.

The dark palette is defined **once** under `.dark`. `domain/theme.ts` (unchanged) resolves `system` → light/dark, and a `ThemeProvider` toggles `.dark` on `<html>` and listens to `matchMedia`. A tiny inline-free boot script in `main.tsx` applies the class before first paint, so there's no flash.

### 4.2 Scale

- **Spacing:** Tailwind's 4px base (`--spacing: 0.25rem`). Use utilities only (`p-2`, `gap-3`, …). No `[7px]`.
- **Type:** `text-2xs 11px`, `text-xs 12px`, `text-sm 13px`, `text-base 14px`, `text-lg 16px`, `text-xl 20px`, `text-2xl 24px`, `text-3xl 28px`. Weights: 400, 500, 600 only.
- **Radius:** `--radius: 0.375rem` (6px) for cards and dialogs, 5px for controls, 4px for chips. `sm/md/lg/xl` are derived the way T3 Code does it. Paper is deliberately squarer than today's 8px.
- **Fonts:**
  - `--font-sans` (system UI stack) for chrome and controls.
  - `--font-serif` (`"Iowan Old Style", Charter, "Palatino Linotype", Palatino, Georgia, serif`) for the brand name, page and course titles, reading text, flashcard questions, stat numbers, and section labels.
  - `--font-mono` for the log only.
- **Reading:** `--read-size: 17.5px`, `--read-leading: 1.75`, `--read-max: 40rem`. Titles: course title 21px, document title 2.2em, both serif at weight 500.
- **Layout:** `--sidebar-width: 14.75rem`, `--index-width: 15rem`, header `52px`, action bar `44px`, `--log-min-h`. No icon-rail width; see §6.1.
- **Motion:** `--ease-out-soft`, `--transition-duration-fast: 120ms`, `--transition-duration-panel: 200ms` (Tailwind utilities `ease-out-soft`, `duration-fast`, `duration-panel`). Every panel animation also respects `prefers-reduced-motion`.

### 4.3 Reading typography
`@layer components { .prose-arbor { … } }` in `index.css` carries over today's `.reading-pane` rules (headings, lists, code, page chips), rewritten with tokens. It's used for digest notes, chat answers, and the study plan. No `@tailwindcss/typography`: we want exact control, and it's small.

### 4.4 Visual language (rules from the mockup)
- **Hairlines, not fills.** Regions are separated by 1px `--border` lines, and the action bar uses a dashed bottom border. Surfaces are flat, and only cards and dialogs get `--shadow`.
- **Active state is a 2px olive bar.** The active row in the sidebar and the notes index gets a 2px `--primary` bar on the left with no background fill. The icon on an active row turns olive.
- **Tabs are underlined.** Mode tabs and the flashcard deck toggle use a 2px `--primary` underline. Each mode tab has a 14px lucide icon, which turns olive when active.
- **Section labels** ("Library", "Course", "Digests") are italic serif, 13px, in `--faint-foreground`. No uppercase.
- **Icons:** lucide, stroke width **1.75**, 16px in rows and icon buttons and 14px in tabs and small buttons, always `currentColor`. Course rows use the `book-open` icon; the Overview row uses `house`.
- **Chips:** 24px tall, 4px radius, a 1px border, `--accent-foreground` text, and `--accent` fill on hover.
- **Density:** 30px sidebar rows, 28px buttons and icon buttons, 38px for primary page actions and flashcard grade buttons.

## 5. Component library

### 5.1 Primitives (`components/ui`, via `npx shadcn add`)
`button`, `input`, `textarea`, `select`, `checkbox`, `switch`, `label`, `field`, `input-group`, `dialog`, `alert-dialog`, `sheet`, `popover`, `menu`, `tooltip`, `toast`, `badge`, `kbd`, `separator`, `scroll-area`, `tabs`, `toggle-group`, `command`, `sidebar`, `collapsible`, `empty`, `spinner`, `skeleton`, `table`.

Conventions, taken from T3 Code's `button.tsx`:
- **`Button` is the only button.** Variants: `default`, `secondary`, `outline`, `ghost`, `ghost-muted`, `destructive`, `link`. Sizes: `xs`, `sm`, `default`, `lg`, `icon-xs`, `icon-sm`, `icon`.
- **Every size fixes the SVG size inside it** (`[&_svg]:size-4`, etc.), so an icon can't end up off-center or the wrong size.
- An icon-only button **requires** an `aria-label` and gets a `Tooltip` with the same text. The type is enforced with a discriminated prop.
- `disabled`, focus-visible ring, and pressed state are defined once in the base class.

### 5.2 Arbor composites (`components/app`)

| Component | Replaces |
|---|---|
| `AppShell` | `.app/.shell/.main-wrap` |
| `AppSidebar` (+ `WorkspaceTree`, `CourseRow`, `AddCourseInline`, `ProviderStatus`) | sidebar markup, `renderCourseList`, `.workspace-root`, `.nav-item`, `.auth-badge` |
| `CourseHeader` (title, mode `Tabs`, Add files, Search) | `.course-header`, `.mode-tabs`, `.search-btn` |
| `ActionBar` (Update knowledge, Cancel, Check citations, `StatusPill`, log toggle) | the action half of `.inspector` |
| `LogDrawer` | the log half of `.inspector`, `logLine`, `openInspector` |
| `StatusPill` | `.inspector-status`, `.status-*` |
| `PageHeader` | `.place-view h2/p` |
| `SettingsSection`, `SettingRow` | `.settings-group`, `.setting-row` |
| `EmptyState` (on `ui/empty`) | `.welcome`, `.coming-soon`, `.empty-actions` |
| `ListRow` | `.digest-link`, `.concept-list-item`, sync conflict file buttons |
| `SectionLabel` | `.nav-label`, `.digest-index-header`, `.concept-section-label` |
| `Chip` | `.page-chip`, `.source-chip`, `.concept-neighbor`, `.citation-badge` |

### 5.3 Dev gallery
A dev-only route, `/dev/ui`, renders every primitive and composite in every variant and size, in light and dark, next to a token sheet (colors, type, spacing, radius). It's stripped from production builds with `import.meta.env.DEV`. This is where spacing and centering get reviewed, and where screenshot tests point (§9).

## 6. App shell behavior

### 6.1 Sidebar
- Built on shadcn `sidebar` with **`collapsible="offcanvas"`**: the sidebar is either **shown** (14.75rem) or **completely hidden**. There is no icon rail.
- Hiding animates the width to 0 (`--duration-panel`). While hidden, a `SidebarTrigger` (`panel-left` icon) appears at the left of the course header.
- Toggle with the trigger, the button in the sidebar header, or **`Mod+B`**. The state is persisted in `ui-store` (`localStorage`, not a cookie).
- Below `md` (768px), showing the sidebar opens it as an overlay `Sheet` over the content instead of pushing it. To support narrow windows, lower `tauri.conf.json` `minWidth` from 900 to 640 (see D4).

### 6.2 Course header and action bar
- The header has the sidebar trigger, course title, mode tabs (Notes / Flashcards / Quiz / Graph / Chat), Add files, and Search.
- The **action bar** is a slim row under the header, visible only in course views: **Update knowledge** (primary), **Cancel** (only while a job runs), **Check citations**, the `StatusPill` (idle / running with spinner and step text / failed), and the **log toggle** with an unread dot.
- The library-role note (viewer cannot write) moves next to the disabled Update button as a tooltip and inline hint.

### 6.3 Log drawer
- A resizable bottom panel. **Closed by default.** It opens only by user action: clicking the log toggle, **`` Mod+` ``**, or "View log" in a failure toast.
- Its open/closed state and height are persisted.
- **Nothing opens it programmatically.** Every one of the 74 `logLine` calls becomes `jobStore.append(line)`. That increments `unread` while the drawer is closed and updates the `StatusPill` step text.
- On job failure, show a `toast` (destructive) with "View log". The drawer still doesn't force itself open.
- Lines are kept in a ring buffer (cap 5,000), rendered with `@tanstack/react-virtual`, and appended in `requestAnimationFrame` batches. It auto-scrolls only when already at the bottom.
- The Jobs page reads per-job logs from `get_job_events` in its own view, separate from the live drawer.

### 6.4 File review → dialog
`renderReview` (the "Files to process" table with page ranges) moves out of the inspector into a `Dialog`, opened by `plan_update`. It uses `Table`, `Input` for ranges with inline validation through the existing `parseRanges`, and Confirm/Cancel in the dialog footer.

### 6.5 Search
The absolute-positioned overlay becomes a **command palette** (`ui/command` in a `Dialog`), opened with **`Mod+K`** or the header button. It has the semantic toggle and the existing `search-hit` logic, and Enter opens the result in Notes at the heading.

### 6.6 Course landing: always the Overview
- Opening a course always lands on **Notes → Overview**, never on a digest. That covers app start (reopen the last course), clicking a course in the sidebar, and switching knowledge roots. The app remembers the last **course**, not the last digest.
- Route: `#/course/:course/notes` (index route) is the Overview. `#/course/:course/notes/:digest` is a digest, reached only by the user picking it from the index, the course map, a link inside a note, or a search result.
- Since 0.5.2 the Overview's study data comes from **one call**: `study_progress { action: "overview" }` returns `due` (due ids, count, deck count), `weak` (topics with digest and heading), and `recommend` (items). It becomes the `useCourseOverview(root, course)` query. Quiz accuracy still comes from `read_quiz_progress`, and the exam date from the study plan. Top to bottom:
  1. Title and summary from `course.md`.
  2. A stat strip: cards due (flashcard deck plus due ids), quiz accuracy (`read_quiz_progress`), and days to the exam (study plan exam date). A tile is omitted when its data doesn't exist.
  3. Next actions: "Review N due cards", which goes to Flashcards, and "Explain weakest topic".
  4. The **course map**: digests newest first, with a one-line summary, and "new" or "weak" flags from the overview payload's weak topics and recommendations. **Gap:** the payload has no per-digest score, so the mockup's "weak · 54%" / "82%" numbers aren't available. Show the flag only, unless D10 extends the worker's overview action.
  5. The study plan and an exam-focus callout.
- The digest list in the notes index pane starts with an **Overview** row (`house` icon), followed by the digests.

### 6.7 Notes index pane
Collapsible like the sidebar (toggle button plus persisted state). When closed, the reading pane is centered at `--reading-max`.

### 6.8 Keyboard map (`lib/shortcuts.ts`, shown in Settings → Shortcuts)

| Action | Shortcut |
|---|---|
| Toggle sidebar | `Mod+B` |
| Toggle log | `` Mod+` `` |
| Search | `Mod+K` |
| Notes / Flashcards / Quiz / Graph / Chat | `Mod+1` … `Mod+5` |
| Settings | `Mod+,` |

Flashcard and quiz keys (flip, grade, next) are scoped to their views.

## 7. Data and state

- **`lib/ipc.ts`:** typed `invoke<T>(cmd, args)` built on the existing `tauri.ts` desktop-only guard. The UI calls 53 commands as of 0.5.2 (inventory in Appendix A). Since 0.5.2 every Rust command is async, short reads go to a persistent `arbor-worker serve` pool, and calls have deadlines. So `invoke` never blocks the window, and a timeout comes back as a rejected promise. `ipc.ts` keeps those error strings intact, because `isTransientStudyWriteError` matches on them.
- **Queries:** one hook per read command, e.g. `useCourses(root)`, `useDigests(root, course)`, `useMarkdown(path)`, `useSettings()`, `useJobs()`, `useLibrary(root)`, `useSyncState(root)`. Writes are `useMutation`s that invalidate the affected keys.
- **Events (`lib/events.ts`):** subscribed once in the root provider.
  - `arbor://progress` → `jobStore.append`
  - `arbor://job-finished` → `jobStore.finish`, then invalidate digests, study, flashcards, quiz, and graph for that course. The current `handleJobFinished` auto-embed/auto-quiz chaining moves here unchanged.
  - `arbor://files-changed` → invalidate the library and digests, keeping the `suppressWatchUntil` behavior.
- **Navigation:**
  - Place, course, and mode live in the **URL**: `#/course/:course/:mode`, `#/jobs`, `#/settings/:section`.
  - Active root, provider, and appearance live in settings and the query cache.
  - Ephemeral view state (current flashcard review, quiz review, selected concept) lives in feature-local `useState`/`useReducer`, using the existing pure `domain/` reducers (`flipReview`, `gradeFlashcard`, `submitChoice`, …).
- This replaces the 61 module-level `let`s, so there's no global mutable state left.

### 7.1 Carry over the 0.5.2 (#97) behavior
Issue #97 shipped in 0.5.2 as hand-written caching in `main.ts`. Each piece maps onto the new data layer, and none of it may regress:

| 0.5.2 behavior (`main.ts`) | 0.6.0 equivalent |
|---|---|
| Auth result cached 60 s, concurrent checks coalesced (`refreshAuthRequestKey`, `runRefreshAuth`); refocus does nothing if checked < 60 s ago; no polling | `useAuth(provider, root)` query: `staleTime: 60_000`, `refetchOnWindowFocus: true` (it respects `staleTime`), no `refetchInterval`. react-query dedupes concurrent calls. |
| Only the chosen provider is checked; the UI never calls `list_providers`; the picker is built from the static `PROVIDER_FALLBACK` list | `PROVIDER_FALLBACK` moves to `domain/provider.ts`. The Settings picker renders from it with no query. A test asserts `list_providers` is never invoked. |
| `modelsCache` keyed by provider and root, refreshed on provider change, root switch, or the refresh button | `useModels(provider, root)` with `staleTime: Infinity`, invalidated on those three events only. |
| `refreshSyncUi` reads run in parallel; the effective provider is applied only on startup, root switch, or provider/library change | Independent queries already run in parallel. `applyEffectiveProviderForActiveRoot` becomes an effect keyed on those events, not on opening Settings. |
| `courseOverviewMemo` (one `study_progress` overview call per root and course) | `useCourseOverview(root, course)`, invalidated by study writes, `job-finished`, and `files-changed` for that course. |
| **Study writes queue** (`study-writes.ts`): flashcard grades, quiz answers, and make-card update the screen at once and save in the background. Per-course lanes, retry at 1 s / 5 s / 30 s, mirrored to `localStorage` (`arbor.pendingStudyWrites`) and replayed on next launch, "N unsaved · Retry" button, a notice when a write is dropped | Keep `study-writes.ts` **as is** in `domain/`; it's already DOM-free and tested. One `StudyWritesProvider` creates the queue at startup and replays pending writes. Grades update the view state and the query cache optimistically (`setQueryData`), then `enqueue`. Do **not** use react-query's own mutation retry for these: the queue's persistence across quits is the point. `onStatus` feeds an `UnsavedBadge` (flashcard and quiz toolbars). `onDropped` shows a destructive toast. `onSent` invalidates `useCourseOverview`. |


## 8. Performance

- **React Compiler on for all of `src/`.** Add a CI check, like T3 Code's `reactCompilerCoverage.test.ts`, that fails if a component bails out of compilation.
- **Route-level code splitting:** Graph, Settings, Jobs, and Chat are lazy. The Notes view is in the main chunk.
- **Bundle budget:** a `scripts/check-bundle.mjs` step fails the build if the initial JS exceeds **250 KB gzip** (to be tuned after Phase 1, since the first measurement sets the baseline).
- **Virtualize** the log, job history, and digest list once a course passes ~100 digests.
- **Markdown:** keep `domain/markdown.ts` (it already escapes HTML). Render once per `(path, content hash)` through `useMemo`-free caching in the query `select`. Inject with `dangerouslySetInnerHTML` inside `.prose-arbor`. Chat streaming re-renders only the live bubble.
- **Measure, don't guess:** record time-to-first-paint and time-to-interactive on Linux and macOS for the old and new UI before cutover. Cutover requires the new UI to be ≤ the old on both.
- **0.5.2's targets are regression gates** (from the #97 plan, §5). Before cutover, re-run them on the new UI with `scripts/bench-worker.sh` and the `ARBOR_PERF=1` command log:
  - course or tab switch < 200 ms to content
  - flashcard grade or quiz answer → next item < 50 ms, even with the worker slow or down
  - window refocus within 60 s of the last check → 0 worker calls
  - opening Settings → 0 provider probes
  - a slow worker (`sleep 10` fake) never freezes drag, resize, or tab changes

## 9. Testing and verification

- **Keep** the 10 pure-logic test files as they are (moved with `domain/`): `markdown`, `flashcards`, `quiz`, `concepts`, `citations`, `chat`, `theme`, `search-hit`, `tauri`, `study-writes` (new in 0.5.2), plus the pure parts of `capabilities` and `workers-persist`.
- **Replace** the 14 source-regex tests (`brand-mark`, `concepts-ui`, `flashcards-ui`, `quiz-ui`, `library-role`, `library-ui`, `library-ui-shared`, `provider-ui`, `skills-ui`, `sync-ui`, `workers-ui`, `workspace-ui`, `citations`, `chat` UI parts, and 0.5.2's `issue-97-phase4`) with **behavior tests**. `issue-97-phase4` becomes two: "grading advances the card before `study_progress` resolves" (with a never-resolving `mockIPC` handler) and "no flow ever invokes `list_providers`". Each one renders a feature with `mockIPC`, interacts through Testing Library, and asserts on what the user sees and which IPC commands fire. Each phase-5 PR ports the tests for its feature; the old file is deleted in the same PR.
- **Mock IPC dev mode:** `npm run dev:mock` runs the app in a plain browser with `mockIPC` and fixture data (`src/test/fixtures`). It's for design iteration and screenshots without Tauri or the worker.
- **Screenshot matrix (Playwright, headless):** every route plus `/dev/ui`, at 3 widths (700, 1100, 1600), in light and dark, against `dev:mock`. The images are attached to each PR for review, not used as pixel-diff gates, at least to begin with.
- **Never on the user's display.** All visual checks run headless or on an isolated display (`Xvfb`/nested). Live Tauri smoke tests follow the existing isolation rule.
- **Live check before cutover:** one real Tauri run on Linux (isolated display) and macOS covering the parity checklist (Appendix B), using the Grok provider.

## 10. Guardrails (CI, from Phase 1 on)

- `eslint` with `react-hooks`, `react-compiler`, and `better-tailwindcss` (class ordering, unregistered classes).
- **`scripts/check-styles.mjs`:** outside `src/index.css`, fail on:
  - hex/rgb colors
  - arbitrary Tailwind values with raw units (`-[13px]`, `-[#…]`)
  - `style={{` objects with spacing, color, or size keys
  - any Unicode glyph in `←-⯿` or emoji ranges in `.tsx`

  `components/ui` gets a short allowlist for Base UI positioning math.
- `tsc --noEmit`, `vitest run`, the bundle budget, and the compiler coverage check all run in `test.yml`'s desktop job.

## 11. Delivery plan

All work goes to an integration branch, **`feat/ui-react`**, cut from `main` (0.5.1). Each step below is one PR into it: Composer implements, Claude reviews and merges. The integration branch merges to `main` only at cutover, so shipping releases keep the old UI until the new one reaches parity.

| # | PR | Contents | Done when |
|---|---|---|---|
| 1 | **Toolchain** | React 19, compiler, Tailwind v4, shadcn init (`components.json`, base style, lucide), TanStack Router/Query, zustand, vitest + RTL + happy-dom, eslint, `~` alias; move legacy to `legacy.html` (dev only); move pure modules to `src/domain/`; new `index.html` → `main.tsx` placeholder | `npm run build`, `npm test`, `tauri build` pass on Linux; legacy UI still reachable at `/legacy.html` in dev; all kept logic tests green |
| 2a | **Design direction** ✅ | 3 mockup directions, then the chosen blend: `docs/design/2026-10-18-ui-arbor-paper.html` | **Done 2026-10-18.** Arbor Paper chosen; values in §4 |
| 2 | **Tokens + theme** | `index.css` per §4, `ThemeProvider`, no-flash boot, `prose-arbor`, token sheet in `/dev/ui`, `check-styles.mjs` | token sheet screenshots light/dark reviewed; colors match legacy side by side |
| 3 | **Primitives** | shadcn components from §5.1, adjusted to tokens, `Button`/`Tooltip` icon-label rule, gallery | gallery screenshots at 3 widths × 2 themes; every icon button visually centered; no lint exceptions outside the allowlist |
| 4 | **Data layer** | `ipc.ts`, query hooks for all read commands, mutations, `events.ts`, stores, `StudyWritesProvider` around the existing queue, the §7.1 cache rules (auth 60 s, models, static providers, course overview), `mockIPC` + fixtures, `dev:mock` | unit tests for event → store/invalidation mapping and for each §7.1 rule; `dev:mock` boots |
| 5 | **Shell** | `AppShell`, `AppSidebar`, `CourseHeader`, `ActionBar`, `LogDrawer`, `StatusPill`, toasts, shortcuts, routes, responsive rules, `minWidth` change | sidebar shown/hidden + `Mod+B` persisted, no rail; log closed by default and stays closed through a mocked job; failure toast → View log; layout correct at 700/1100/1600 |
| 6 | **Welcome + library** | first-run/choose folder, add class inline, workspace roots, root switch, import files, file review dialog | behavior tests replace `workspace-ui`, `library-ui*`, `brand-mark` |
| 7 | **Notes** | **Overview landing page (§6.6)**, index pane (collapsible), reading pane, concept chips, study plan + recommendations, weak topics, make-card (selection → dialog → `append_card`), heading scroll | parity items B.3; tests for make-card and digest navigation |
| 8 | **Flashcards** | due/full toggle, flip/grade keys, optimistic grades through the study-writes queue, `UnsavedBadge`, stale badge, generate | replaces `flashcards-ui` test |
| 9 | **Quiz** | pack, choices, submit/next/prev, score, answers through the study-writes queue, `UnsavedBadge`, auto-generate | replaces `quiz-ui` test |
| 10 | **Graph** | concept list + detail, neighbors, sources, figures/unverified styles, generate concepts/diagrams | replaces `concepts-ui` test |
| 11 | **Chat** | course/root selectors, ask/explain/quiz modes, streaming bubble, history, clear, artifacts row, auth error copy | replaces chat UI assertions |
| 12 | **Search** | command palette per §6.5 | semantic toggle, result → heading |
| 13 | **Jobs** | history list (virtualized), per-job log view, status | |
| 14 | **Settings** | sectioned route: General/Appearance, Provider & models (keys, base URLs, overrides, recommendations), Library & sharing (create/join, members, provider), Sync (remote, shared, conflicts dialog), Skills (index, install/run/uninstall, permission confirm), Workers (SSH list/form/test, per-root worker), Shortcuts | replaces `provider-ui`, `library-role`, `sync-ui`, `skills-ui`, `workers-ui` tests |
| 15 | **Perf + polish** | bundle budget tuned, compiler coverage, virtualization, reduced motion, a11y pass (focus order, labels, contrast check on both palettes) | perf numbers ≤ legacy (§8) |
| 16 | **Cutover** | delete `legacy.html`, `main.ts`, `styles.css`, remaining regex tests; update README/PROJECT.md; CHANGELOG; release **0.6.0**; `tauri.conf.json` `minWidth` 640, `bundle.macOS.minimumSystemVersion` `13.3` | parity checklist (Appendix B) signed off on a live Linux + macOS run |

PRs 6–14 depend on 5 but not on each other. Run them in parallel, one Composer task each, after PR 5 merges.

## 12. Brief for implementers (paste into every Composer task)

1. Read this plan and the `components/ui` file you're touching first. Model new primitives on T3 Code's equivalent file (`apps/web/src/components/ui/<name>.tsx`) for structure; don't copy it verbatim.
2. No raw colors, px values, or arbitrary Tailwind values outside `src/index.css`. If a token is missing, add it there in the same PR and say so in the PR description.
3. Every clickable element is `Button` (or a Base UI primitive). Every icon is `lucide-react`, sized by the parent's variant, never by ad-hoc classes.
4. Never open the log drawer, a dialog, or a panel programmatically, except where this plan says so (file review dialog after `plan_update`; confirm dialogs).
5. Worker data goes through `lib/queries`. No `invoke` inside components. No module-level mutable state.
6. Reuse `src/domain/*` logic. Don't rewrite flashcard/quiz/markdown logic inside components.
7. Each PR includes behavior tests for its feature, deletes the regex tests it replaces, and attaches the screenshot matrix for touched routes.
8. Never launch the Tauri window on the user's display. Use `dev:mock` + headless Playwright.
9. React 19 + compiler: no manual `useMemo`/`useCallback`/`memo` unless the compiler can't handle the case (comment why).

## 13. Decisions (recorded 2026-10-18)

- **D1. Version:** ship the cutover as **0.6.0**.
- **D2. Router:** TanStack Router, set up as in T3 Code: file-based routes, the Vite plugin with automatic code splitting, and hash history.
- **D3. Look:** **Arbor Paper.** Paper's structure, the logo's olive and bark colors, and Tool neutral's lucide icons (§4).
- **D8. Sidebar:** shown or fully hidden. No icon rail.
- **D9. Course landing:** always the Overview. The user opens digests themselves (§6.6).
- **D10. Open: per-digest scores on the course map.** The 0.5.2 overview payload has no per-digest accuracy. Either show "weak" / "new" flags only (no worker change), or add a per-digest score to `study_progress --action overview` in a worker PR before PR 7. *Recommend: flags only for 0.6.0; add scores later if wanted.*
- **D4. Window minimum width:** lower it from 900 to 640.
- **D5. macOS minimum:** 13.3.
- **D6. Log on failure:** a toast with "View log"; the drawer never opens itself.
- **D7. Component style:** shadcn `base-mira` plus the `@coss` registry, as T3 Code uses.

---

## Appendix A: IPC inventory (from `main.ts`, as of 0.5.2)
Commands:

`append_card` `append_chat_lines` `cancel_update` `check_auth` `clear_chat_history` `clear_provider_secret` `create_course` `create_shared_library` `get_job_events` `get_knowledge_settings` `get_settings` `import_sources` `init_arbor_db` `init_knowledge_repo` `library_set_members` `library_set_provider` `library_show` `list_courses` `list_digests` `list_jobs` `list_models` `plan_update` `provider_secret_status` `read_chat_history` `read_markdown` `read_quiz_progress` `read_study_json` `read_sync_conflict` `reindex_knowledge` `save_knowledge_settings` `save_settings` `set_provider_secret` `skill_index` `skill_install` `skill_run` `skill_uninstall` `start_chat` `start_embed_job` `start_folder_watch` `start_update` `study_artifact_stale` `study_plan` `study_progress` `sync_continue` `sync_now` `sync_resolve` `sync_set_remote` `sync_set_shared` `sync_show` `test_worker_connection`

Events: `arbor://progress`, `arbor://job-finished`, `arbor://files-changed`.

As of 0.5.2 the UI no longer calls `list_providers` (the Rust and CLI command still exists). `study_progress` gained `action: "overview"`.

**Correction (2026-10-19, PR 4):** the list above came from a regex over `invoke("…")` calls and missed four commands the legacy UI calls through other paths: `start_study_job` (flashcard/quiz/concept/diagram/citation jobs), `join_library`, `search_knowledge`, and `search_semantic`. The authoritative list is `generate_handler!` in `desktop/src-tauri/src/lib.rs` intersected with the commands `src/legacy/main.ts` uses.

## Appendix B: parity checklist (sign-off before cutover)
1. **First run:** choose a Knowledge folder; init repo/db; welcome state; desktop-only message outside Tauri.
2. **Library:**
   - multiple roots grouped in the sidebar; switch root (restarts folder watch, reloads jobs, re-runs search)
   - add class with validation errors
   - Add files → import → plan → review dialog with ranges and alignment notes → update
3. **Notes:**
   - opening any course (start, sidebar, root switch) lands on the Overview, never a digest
   - Overview: stats, next actions, course map with weak/new flags, study plan
   - digests list; digest links inside markdown; heading scroll
   - page chips; concept chips per digest
   - study plan with exam date; recommendations; explain weakest; weak topics
   - make card from a selection (heading/page captured)
4. **Flashcards:** due vs full deck, flip, again/wrong/mastered, requeue/drop, the next card shows immediately while the grade saves in the background, "N unsaved · Retry", pending grades replayed after a forced quit, progress persisted, stale badge, generate/regenerate, focus a card after make-card.
5. **Quiz:** generate, auto-generate after update, select/submit/next/previous, score, answers saved through the study-writes queue ("unsaved · Retry" too), progress persisted.
6. **Graph:** generate concepts and diagrams, list with figure/unverified styling, neighbors navigation, sources → notes.
7. **Chat:** root/course select, ask/explain/quiz modes, streaming, history persisted, clear, auth-error messages, artifact actions.
8. **Citations:** check citations job, report rendering, citation badges.
9. **Search:** text and semantic, open result at heading.
10. **Jobs:** history, per-job log, cancel a running job, status in the action bar.
11. **Settings:**
    - appearance (system/light/dark)
    - provider + model, API keys, Ollama/LM Studio base URLs, per-root overrides, recommendations
    - only the chosen provider is ever checked; sign-in status cached 60 s; opening Settings or refocusing within 60 s makes no worker call
    - library create/join, members, roles (viewer write-blocking), library provider
    - sync remote/shared/now, conflict dialog (text, binary, resolve, continue)
    - skills index/install/permissions/run/uninstall
    - SSH workers CRUD + test + per-root assignment
12. **Shell:** sidebar shown/hidden persisted (no rail), log drawer closed by default and never self-opening, shortcuts, light/dark, widths 640–1600+.

# PR 5: App shell

Branch `ui/05-shell`, stacked on `ui/04-data-layer`. Master plan §6.1–6.3, §6.6 (routing part), §6.8, §11 row 5, decisions D4, D6, D8, D9. Read `README.md` in this folder first: **no browser, never launch the app window, never run `dev:mock`.** The design reference is `docs/design/2026-10-18-ui-arbor-paper.html`. **Read its source** for exact structure: sidebar, header, action bar, log drawer.

## Goal
The real app frame, driven by PR 4's data layer and built only from PR 3 primitives and composites: sidebar, course header, action bar, log drawer, routes, shortcuts, and responsive behavior. Each course mode shows a simple placeholder; the screens arrive in PRs 6–14.

## Work directory
`/home/flow/Projects/personal/Arbor/.worktrees/ui-stack/desktop`

## 1. Routes (TanStack file routes; keep `routeTree.gen.ts` committed)
- **`__root.tsx`:** the providers already there, plus `<AppShell>` around `<Outlet/>`. The `/dev/ui` route renders **without** the shell (a pathless layout or a check on the matched route).
- **`index.tsx`** (`/`) decides where to go:
  - no knowledge root → `/welcome`
  - `ui-store.lastCourse` exists and belongs to the active root → `redirect` to `/course/$course/notes`
  - otherwise `/welcome`, or the first course of the active root if there is one
- **`welcome.tsx`:** a placeholder `EmptyState` ("Choose a Knowledge folder…"). PR 6 builds the real one.
- **`_course.tsx`:** a pathless layout for `/course/$course/*`. It renders `CourseHeader` + `ActionBar` + `<Outlet/>`, and on mount and param change sets `ui-store.lastCourse = { root: activeRoot, course }`. The course must exist in `useCourses(activeRoot)`; if not, it shows an `EmptyState` with a link back.
- **Course modes:**
  - `_course.course.$course.notes.index.tsx`: the **Overview** placeholder. A `PageHeader` with the course display name plus the text "Overview arrives in PR 7".
  - `_course.course.$course.notes.$digest.tsx`: a digest placeholder.
  - `.flashcards.tsx`, `.quiz.tsx`, `.graph.tsx`, `.chat.tsx`: placeholders.

  **Opening a course always goes to `notes` (the Overview), never a digest** (D9).
- `jobs.tsx`, `settings.tsx` (layout), `settings.index.tsx`: placeholders inside the shell, with no course header or action bar.
- **Active root:** the course routes are relative to the active knowledge root from settings (`active_root`). Clicking a course in a different root switches the active root first (port legacy `switchKnowledgeRoot` ~1120 as a mutation/hook: save the settings `active_root`, `start_folder_watch`, invalidate queries), then navigates.
- **Display names:** add `courseDisplayName(slug)` in `~/domain` (title-case the slug, keeping roman numerals like `ii` → `II`) unless `list_courses` already returns display names. Check what legacy shows (legacy `renderCourseList` ~1150) and mirror it.

## 2. `AppShell` (`src/components/app/app-shell.tsx`)
- `SidebarProvider` is controlled by `ui-store.sidebarOpen` / `toggleSidebar`, `collapsible="offcanvas"` (D8: shown or fully hidden).
- Layout: the sidebar on the left; the main column holds the matched route content, and the `LogDrawer` is docked at the bottom of the main column.
- **Responsive (D4):**
  - `tauri.conf.json` `minWidth` 900 → **640**
  - below `md` (768px) the sidebar opens as an overlay sheet, through the same controlled state (PR 3 supports this)
  - between 768 and 1024 the sidebar defaults to hidden **only on first run** (no stored preference); after that, respect the stored choice

## 3. `AppSidebar` (`src/components/app/app-sidebar.tsx`), matching the mockup
- **Header** (h-header): the Arbor logo (`src/assets/arbor-mark.png` light, `arbor-mark-dark.png` dark, swapped by theme), "Arbor" in serif, and an `IconButton` (`PanelLeft`, label "Hide sidebar", tooltip shows `⌘B`/`Ctrl+B` by platform) that hides the sidebar.
- **"Library" `SectionLabel`** with an `IconButton` (`Plus`, "Add class") that opens an inline add-class input. Port legacy `createCourseFromForm` (~3170 area): validation error copy, `create_course`, then navigate to the new course's Overview.
- **Workspace tree:** each knowledge root is a collapsible group (`ChevronDown`/`ChevronRight` plus the root label from legacy `workspaceRootLabel` ~1105) containing `ListRow`s for its courses. Each row has the `BookOpen` icon, the display name, and the digest count if available. The active course has the 2px olive bar. Clicking navigates per §1.
- **Bottom block** (hairline top border):
  - `ListRow`s for Jobs (`Activity`) and Settings (`Settings2`)
  - a provider status line: a dot plus "Grok · grok-4.7", from the effective provider and `useAuth(provider)`, with states signed-in / checking / signed-out / worker-unavailable (port the `providerBadge` semantics from `~/domain/provider`)
  - the "Choose Knowledge folder…" action. Port `pickFolder`/`activateKnowledgeRoot` (~3150, ~2100) through `ipc.openDialog`.

## 4. `CourseHeader` (`src/components/app/course-header.tsx`)
- h-header, a hairline bottom border, items aligned as in the mockup.
- A `SidebarTrigger` `IconButton` that's visible **only when the sidebar is hidden**.
- The course title in serif `text-title`, plus a muted subtitle (root label · N digests).
- **Mode `Tabs` (underline variant)** with lucide icons:
  - Notes `BookOpen`
  - Flashcards `Layers`
  - Quiz `CircleHelp`
  - Graph `Share2`
  - Chat `MessageSquare`

  Tabs are links to the mode routes. Selection comes from the route, and the active icon turns olive.
- "Add files": an outline `Button` with `Plus`. It opens the file picker and runs `useImportSourcesMutation` (which presents the update plan). The review dialog UI is PR 6; just leave the plan in the store.
- Search: an outline `Button` with `Search` plus a `Kbd` "⌘K". It opens a placeholder command dialog; the real palette is PR 12.

## 5. `ActionBar` (`src/components/app/action-bar.tsx`)
- h-actionbar, a **dashed** bottom border.
- Left side:
  - **Update knowledge**: primary, `RefreshCw`. Runs the plan → update flow through PR 4 (`usePlanUpdateMutation` + update-plan-store).
  - **Cancel**: shown only while a job runs; `cancel_update`.
  - **Check citations**: ghost, `Check`; the citations study job mutation.

  Respect the viewer write-block (`~/domain/library-role`; legacy `setViewerWriteButtonState` ~600): when blocked, disable and show the tooltip plus an inline hint.
- Right side:
  - `StatusPill` from `job-store` (`idle` → "Up to date · {relative time of last job}", `running` → spinner plus step text, `failed` → "Last job failed")
  - the log toggle `IconButton` (`Terminal`, label "Toggle log", tooltip with ``⌘` ``) with an **unread dot** (`job-store.unread > 0`), styled like the mockup's `.badge-dot`

## 6. `LogDrawer` (`src/components/app/log-drawer.tsx`)
- Docked at the bottom of the main column. **Closed by default.** Open state and height come from `ui-store.logOpen` / `logHeight`, and the height is resizable with a drag handle (min 120, max 60vh).
- Header row: `Terminal` icon, "Log", a clear `IconButton`, and a close `IconButton`.
- **Body:** mono `text-2xs`, virtualized with `@tanstack/react-virtual` (add the dependency) over `job-store.lines`. It auto-scrolls only when already at the bottom.
- Opening the drawer calls `markRead()`.
- **Never opened programmatically** (§6.3). The **only** openers are the toggle button, ``Mod+` ``, and a toast's "View log" action.
- **Job failure (D6):** when `job-store.status` becomes `failed`, show `toast.error("…failed", { action: { label: "View log", onClick: openLog } })`. The drawer itself must not open.

## 7. Shortcuts (`src/lib/shortcuts.ts` + one `useGlobalShortcuts()` in AppShell)
| Shortcut | Action |
|---|---|
| `Mod+B` | Toggle the sidebar (PR 3 already wires it; don't double-handle) |
| ``Mod+` `` | Toggle the log |
| `Mod+K` | Open search (placeholder) |
| `Mod+1…5` | Course modes |
| `Mod+,` | Settings |

`Mod` = ⌘ on macOS, Ctrl elsewhere. Ignore the shortcuts while typing in an input or textarea, except `Mod+K`. Export the table so Settings → Shortcuts (PR 14) can render it.

## 8. Tests (vitest + `renderWithProviders` + mockIPC fixtures)
- `/` redirects to the last course's **notes (Overview)** when `lastCourse` is set, and to welcome when there's no root.
- Clicking a course in the sidebar navigates to `/course/<c>/notes` and sets `lastCourse`; a course in another root switches the active root first (`save_settings` + `start_folder_watch` in the call log).
- The sidebar toggle button and `Mod+B` flip `ui-store.sidebarOpen`; the header trigger appears only when hidden.
- The log is closed by default. Emitting 3 `arbor://progress` events keeps it closed, and the unread dot shows 3. ``Mod+` `` opens it and clears unread.
- A failed job shows a toast with "View log", the drawer stays closed, and clicking "View log" opens it.
- Mode tabs reflect the route; `Mod+2` goes to flashcards.
- The ActionBar is disabled with a hint for the viewer role (fixture variant).
- Add class: validation error, then success → navigates to the new course Overview (`create_course` in the call log).

## 9. Acceptance (run all, report real results)
- `npm test`, `npm run lint`, `npm run build` (report the main chunk gzip; the budget is 250 KB).
- No new `style-allow` without a reason in the report.
- **Needs visual check (Claude):**
  - the shell vs the mockup at 700 / 1100 / 1600 px, light and dark
  - the sidebar shown and hidden
  - the log drawer with and without the unread dot
  - the failure toast
  - the mobile sheet

## Commit
Focused commits on `ui/05-shell`, each ending `Co-Authored-By: Composer 2.5 <noreply@cursor.com>`. Don't push.

# PR 6: Course icons

Branch `ux/06-course-icons`, stacked on `ux/05-study-resume`. Plan: `README.md`. **The agent rules in `../ui-6.0/README.md` apply in full.**

Worktree: `/home/flow/Projects/personal/Arbor/.worktrees/ux-stack`.

## Today

Every course row uses `BookOpen` (`components/app/app-sidebar.tsx` ~71). Courses are just directories under the knowledge root, so there is nowhere to store per-course appearance.

## 1. Storage and Rust

**File:** `<root>/.arbor/courses.json`:

```json
{ "version": 1, "courses": { "<course-slug>": { "icon": "flask-conical", "color": "olive" } } }
```

It's a shared file, synced with the library like `.arbor/library.json`. `python/src/arbor_worker/sync.py::_is_derived_tracked` treats it as tracked by default; add a sync test asserting it is **not** derived.

**Rust** (new small module `desktop/src-tauri/src/course_meta.rs`, registered in `lib.rs`):

| Command | Returns | Behaviour |
|---|---|---|
| `read_course_meta(root)` | `serde_json::Value` | The `courses` map. A missing or corrupt file gives `{}` and never errors. |
| `set_course_meta(root, course, icon: Option<String>, color: Option<String>)` | updated map | `validate_path_component(course)`. `icon` and `color` are each `None` (clear) or `^[a-z0-9-]{1,40}$`. An entry with both cleared is removed. Atomic write (temp + rename) under a `static Mutex<()>`. Unknown keys inside entries are preserved. |

Rust unit tests cover: round trip, clear, invalid course or icon, corrupt file → `{}`, and preserving other courses.

## 2. Domain: `desktop/src/domain/course-icons.ts`

`COURSE_ICONS: readonly { key: string; label: string; Icon: LucideIcon }[]`, about 40 entries grouped by subject. Use lucide icons that exist in the installed `lucide-react` version, and verify each import compiles. Suggested set:
- **Sciences:** book-open (default), flask-conical, atom, dna, microscope, leaf, sprout, brain, heart-pulse, stethoscope, pill, telescope, orbit, mountain, globe, zap, magnet
- **Math and CS:** calculator, sigma, pi, function-square, binary, code, cpu, database, chart-line
- **Humanities:** landmark, scroll, feather, book-text, languages, quote, music, palette, theater
- **Social and business:** scale, briefcase, banknote, users, gavel

Also:
- `COURSE_COLORS`: 8 keys (`olive`, `bark`, `clay`, `sky`, `plum`, `sand`, `slate`, `moss`), mapped to **CSS tokens**. Add `--course-<key>` in both the light and dark blocks of `src/index.css`, plus `@theme` entries. Raw colours are allowed only in `index.css`. Pick hues that sit with "Arbor Paper" (olive #586D37, bark brown) and stay legible as a 14px icon colour in both themes.
- Helpers: `courseIconFor(meta, course)` returns the icon component (unknown or missing → `BookOpen`); `courseColorClass(meta, course)` returns a token class or `""`.

Unit tests:
- every key is unique;
- every entry has an Icon;
- unknown keys fall back.

## 3. Queries

In `lib/queries/library.ts` (or a new `course-meta.ts`):
- `useCourseMeta(root)` reading `read_course_meta`;
- `useSetCourseMeta(root)` with an optimistic update and invalidation.

`ipc.ts` gains the two command names. `test/mock-handlers.ts` implements both in memory and seeds two courses with icons.

## 4. UI

**Picker** (`components/app/course-icon-picker.tsx`): a `Popover` with a grid of `IconButton`s (aria-label = the icon label, `aria-pressed` for the current one), a colour swatch row (`aria-label` per colour), and a "Reset" link that clears both.
- Keyboard: arrow keys move through the grid, if the primitives allow it. Otherwise tab order is enough.
- **Viewers can't change it:** use `viewerBlocksWrite(role)` from `domain/library-role` (as `use-study-job-launcher.ts` does). When blocked, the picker trigger is disabled with the `VIEWER_WRITE_REASON` tooltip.

**Entry points:**
- **Course header** (`components/app/course-header.tsx`): the course icon becomes a button left of the title that opens the picker.
- **Sidebar course row** (`app-sidebar.tsx`): add a row context action. Reuse whatever row-menu pattern exists; if there isn't one, add a hover `MoreHorizontal` `IconButton` to the row with a `DropdownMenu` containing "Change icon…", which opens the same picker anchored to the row.

**Where the icon shows** (with its colour token): the sidebar course rows, the course header, the chat course `Select` items, the search palette's course group headings (`search-palette.tsx` ~214), and the welcome screen's course list, if it lists courses.

## 5. Tests

- **vitest:** picking an icon updates the sidebar row icon and the header icon (assert via `data-icon` attributes or aria); colour applies; reset; viewer-disabled.
- **Rust and Python** tests as above.

## 6. Checks

Wrap each in `timeout 600` and paste the tail with `EXIT=$?`:
- `cd desktop && npm test`
- `npm run lint`
- `npm run build`
- `cd desktop/src-tauri && cargo test course_meta`
- `cd python && uv run pytest -q`

Commit in logical commits:
1. Rust and sync test
2. domain, tokens and queries
3. UI

---

## Execution plan

Composer implements → Claude reruns → Grok QA (focus: path safety, sync tracking, viewer gating, tokens in both themes, picker accessibility) → Composer fix round → Claude audit plus a headless preview (picker, sidebar, header, light and dark) → push and open a stacked PR.

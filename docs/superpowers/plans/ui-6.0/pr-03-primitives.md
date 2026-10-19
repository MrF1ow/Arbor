# PR 3: Component primitives

Branch `ui/03-primitives`, stacked on `ui/02-tokens`. Master plan §5 (5.1, 5.2, 5.3), §4.4, §11 row 3. Read `README.md` in this folder first: **no browser, never launch the app window.** The reference for structure is T3 Code's `apps/web/src/components/ui/*` (github.com/pingdotgg/t3code, MIT). Read files with `gh api repos/pingdotgg/t3code/contents/apps/web/src/components/ui/<name>.tsx --jq .content | base64 -d`. Model structure on it; don't copy it verbatim.

## Goal
All shared UI building blocks exist, are restyled to Arbor Paper tokens, and appear in the `#/dev/ui` gallery in every variant and size. No app screens yet (the shell is PR 5).

## Work directory
`/home/flow/Projects/personal/Arbor/.worktrees/ui-stack/desktop`

## 1. Add primitives with the shadcn CLI
Use `npx shadcn@latest add <names>` (style `base-mira` from `components.json`, Base UI underneath). If a component isn't in the default registry, try the `@coss` registry (`npx shadcn@latest add @coss/<name>`). If neither has it, write it on Base UI directly.

Components: `button`, `input`, `textarea`, `select`, `checkbox`, `switch`, `label`, `field`, `input-group`, `dialog`, `alert-dialog`, `sheet`, `popover`, `menu` (dropdown menu), `tooltip`, `toast`, `badge`, `kbd`, `separator`, `scroll-area`, `tabs`, `toggle-group`, `command`, `sidebar`, `collapsible`, `empty`, `spinner`, `skeleton`, `table`.

Files go in `src/components/ui/`. The CLI may add hooks (e.g. `use-mobile`) to `src/hooks/`; that's fine. Commit the generated files first, unmodified, in one commit ("add shadcn primitives (stock)") so the next commit's restyle diff is reviewable.

## 2. Restyle to tokens (second commit)
Go through every file and make it obey the token system:
- **Colors:** only token classes (`bg-primary`, `hover:bg-primary-hover`, `bg-backdrop`, `text-muted-foreground`, `border-border`, `bg-selected`, `bg-accent`, …).
  - Replace opacity hacks like `bg-primary/80`, `bg-black/80`, `bg-black/50`, `bg-destructive/10` with the matching tokens: `hover:bg-primary-hover`, `bg-backdrop`, `bg-destructive-surface`.
  - Keep `/NN` opacity only where no token fits, and add `// style-allow: <reason>` on that line.
- **z-index:** `z-dropdown`, `z-drawer`, `z-overlay`, `z-dialog`, `z-toast` instead of `z-50` and similar.
- **Motion:** `duration-fast`, `duration-panel`, and `ease-out-soft` instead of `duration-200` etc.
- **Radius:** `rounded-sm` (5px controls), `rounded-md` (6px cards/dialogs), `rounded-xs` (4px chips). Paper is squarer than stock shadcn.
- **Sizes:** no arbitrary values (`text-[0.625rem]`, `h-[…]`). Use theme sizes. Where a library positioning value truly needs one, add `// style-allow: <reason>`.
- **Focus:** `focus-visible` ring uses `ring-ring` (2px, offset).

### Button (`button.tsx`): the only button
Use `cva` variants, following T3 Code's `button.tsx` structure.
- **Variants:** `default` (primary olive fill, hover `bg-primary-hover`), `secondary` (`bg-secondary`), `outline` (border, `bg-card`, hover `bg-muted`), `ghost` (transparent, `text-muted-foreground`, hover `bg-muted` + `text-foreground`), `destructive` (`bg-destructive text-destructive-foreground`), `destructive-outline` (border, `text-destructive`, hover `bg-destructive-surface`), `link` (`text-primary`, underline on hover).
- **Sizes:** `xs` (h-6), `sm` (h-control = 28px), `default` (h-control), `lg` (h-control-lg = 38px), `icon-xs` (size-6), `icon-sm` (size-control), `icon` (size-control), `icon-lg` (size-control-lg).
- **Every size fixes its SVG size** with `[&_svg:not([class*='size-'])]:size-icon-sm` (14px) for `xs`/`sm`/`icon-xs`/`icon-sm`, and `size-icon` (16px) for `default`/`lg`/`icon`/`icon-lg`. Also set `[&_svg]:shrink-0 [&_svg]:pointer-events-none`. Children and icons center with `inline-flex items-center justify-center gap-1.5`.
- **One base** for disabled (`disabled:opacity-50 disabled:pointer-events-none`), focus-visible, and pressed (`data-[pressed]` / `aria-pressed` → `bg-selected`).
- **Icon-only buttons:** export `IconButton` with props `{ icon: LucideIcon; label: string; size?: "icon-xs"|"icon-sm"|"icon"|"icon-lg"; variant?; tooltip?: boolean = true; ... }`. It renders `aria-label={label}` and wraps the button in `Tooltip` with the same text. `label` is required by the type. Add a type-level test (`// @ts-expect-error` when `label` is missing) in `button.test.tsx`.
- `asChild`/render-prop support the way base-mira's Button does it (Base UI `render` / `useRender`), so links can look like buttons.

### Others, matching master plan §4.4
- `input`/`textarea`/`select`: `h-control`, `rounded-sm`, `border-input`, `bg-card`, placeholder `text-faint-foreground`, focus ring. `textarea` auto-height optional.
- `dialog`/`alert-dialog`/`sheet`:
  - backdrop `bg-backdrop`
  - popup `bg-popover text-popover-foreground rounded-md shadow-card border-border`
  - title in **serif** (`font-serif font-medium text-xl`)
  - footer actions right-aligned
  - a close button through `IconButton` with lucide `X`
  - put shared class strings in `dialog-styles.ts` like T3 Code
- `tabs`: two variants:
  - `underline` (mode tabs: 2px `border-primary` underline on active, icon turns `text-primary`, no fill)
  - `segmented` (bordered pill group)

  Default to `underline`.
- `badge`: variants `default` (accent fill), `outline`, `success`, `destructive` (destructive-surface), `info`. `rounded-full`, `text-xs`, h-6.
- `tooltip`: `bg-foreground text-background text-xs rounded-sm`, short delay.
- `toast`: on the card surface with a left 2px bar colored by type (success/destructive/info). Support an action button (needed for "View log" in PR 5).
- `sidebar`: keep the shadcn API but **support only `collapsible="offcanvas"`** (master plan D8: shown or fully hidden, no icon rail).
  - Remove the icon-rail code paths, or leave them unused, with a comment.
  - Width `w-sidebar`.
  - Animate with `duration-panel ease-out-soft`.
  - **Replace the cookie persistence with a prop pair** (`open`/`onOpenChange`). PR 5 wires it to the ui-store. Don't write `document.cookie`.
  - Keep the `Mod+B` shortcut.
  - Active menu item style per §4.4: **2px `bg-primary` bar on the left, no fill**; the icon turns `text-primary`; hover `bg-muted`. Row height `h-row`.
- `empty`: centered icon, serif title, muted body, actions slot.
- `spinner`: lucide `Loader2` with `animate-spin`, sized by `size-icon`/`size-icon-sm`.
- `kbd`: `font-mono text-2xs border-border rounded-xs px-1`.
- `table`: hairline borders, `bg-muted` header, `text-sm`.

## 3. Arbor composites (`src/components/app/`)
Generic, reusable, no data fetching. The rest come in later PRs.
- `SectionLabel`: italic serif 13px, `text-faint-foreground` (§4.4). Optional trailing action slot (e.g. an `IconButton`).
- `Chip`: h-6, `rounded-xs`, 1px border, `text-accent-foreground`, hover `bg-accent`. Variant `plain` (`text-muted-foreground`). Renders a `<button>` when `onClick` is given, a `<span>` otherwise.
- `ListRow`: selectable row; `h-row`, the 2px active bar, an optional leading icon (turns olive when active), an optional trailing meta (count/date, `text-2xs text-faint-foreground`), and an optional two-line variant (title + meta below, like the notes index). Props `{ active?, icon?, title, meta?, trailing?, onSelect?, href? }`. Keyboard accessible.
- `EmptyState`: wraps `ui/empty`. Props `{ icon: LucideIcon, title, description?, actions? }`.
- `PageHeader`: serif title, optional description, actions slot.
- `SettingsSection` (`title`, `description?`, children in a bordered card with hairline row dividers) and `SettingRow` (`label`, `description?`, control on the right, `min-h-row`).
- `StatPill`/`StatusPill`: rounded-full `bg-accent text-accent-foreground text-xs` with a leading dot or spinner. Variants `idle`, `running`, `failed`, `success`.

## 4. Gallery (`src/dev/gallery.tsx`, `#/dev/ui`)
Add sections below the tokens (keep the tokens part):
- **Buttons:** a matrix of every variant × every size (text buttons, and `IconButton` with lucide icons). Show disabled and pressed states. Draw a hairline 1px outline around each icon button's SVG in the gallery **only** (e.g. a wrapper class in the gallery) so Claude can verify centering.
- One section each for inputs (normal/disabled/invalid with `Field` error), select, checkbox, switch, tabs (both variants, with icons), badges, kbd, tooltip (open by default in the gallery, or a trigger), dialog / alert-dialog / sheet (trigger buttons), toast (a trigger for each type, plus one with an action), table, empty, spinner, skeleton, command (inline, not in a dialog), and a mini sidebar demo inside a fixed-height box with a toggle.
- All composites from §3: `SectionLabel`, `Chip`s, `ListRow` (single and two-line, active/inactive), `EmptyState`, `PageHeader`, `SettingsSection` with 3 `SettingRow`s, and `StatusPill` in all variants.
- Use realistic Arbor copy (course names, "Update knowledge", "Check citations", digest titles).

## 5. Guardrails
- `check-styles` must pass. `src/components/ui/**` is scanned; use `// style-allow: <reason>` only where necessary and list each one in your report.
- **No Unicode glyph icons anywhere.** Icons only from `lucide-react`.
- ESLint with 0 warnings. No manual `useMemo`/`useCallback`/`memo` (the React Compiler handles memoization); if the stock code has them, remove them unless they are needed for referential identity in an effect (comment why).

## 6. Tests (vitest + Testing Library)
- `button.test.tsx`:
  - variants render; `IconButton` sets `aria-label` and shows a tooltip on focus/hover
  - the type-level test that `label` is required
  - a disabled button doesn't fire `onClick`
- `dialog.test.tsx`: it opens from its trigger, focus moves inside, Escape closes it, and the close button has an accessible name.
- `tabs.test.tsx`: arrow keys move between tabs, and `aria-selected` is set.
- `sidebar.test.tsx`: controlled `open` hides/shows the sidebar (data-state), and `Mod+B` calls `onOpenChange`.
- `list-row.test.tsx`: Enter/Space select, and `aria-current` when active.
- `toast.test.tsx`: an action button renders and fires.

## 7. Acceptance (run all, report real results)
- `npm test` (check-styles, node, vitest), `npm run lint`, `npm run build`.
- Report:
  - the initial JS size from the build output (gzip)
  - any `style-allow` lines
  - any component you couldn't get from a registry
- **No browser.** Claude will visually check the gallery: centering, spacing, both themes.

## Commit
At least two commits on `ui/03-primitives`: stock add, then restyle plus composites, gallery, and tests. Each ends `Co-Authored-By: Composer 2.5 <noreply@cursor.com>`. Don't push.

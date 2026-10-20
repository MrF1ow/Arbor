# PR 2: Design tokens and theme (Arbor Paper)

Branch `ui/02-tokens`, stacked on `ui/01-toolchain`. Master plan §4 (all of it), §5.3, §10, §11 row 2. Read `README.md` in this folder first: **no browser, never launch the app window.** The design reference is `docs/design/2026-10-18-ui-arbor-paper.html`. **Read its CSS and HTML source** for exact values; don't open it in a browser.

## Goal
`src/index.css` becomes the single source of every color, font, type size, radius, size, shadow, z-index, and motion value, in light and dark. Add a theme provider with no flash, the `prose-arbor` reading styles, a dev-only token sheet at `#/dev/ui`, and the style guard script. No app components yet (PR 3).

## Work directory
`/home/flow/Projects/personal/Arbor/.worktrees/ui-stack/desktop`

## 1. `src/index.css`
Structure, in this order:
1. `@import "tailwindcss";`
2. `@custom-variant dark (&:where(.dark, .dark *));`
3. **`:root` (light palette).** Raw values for every token in master plan §4.1:
   - `--background #F6F1E7`, `--foreground #2B2420`, `--card #FBF8F1`, `--popover #FBF8F1`, `--sidebar #F3EDE1`
   - `--muted #EDE6D8`, `--muted-foreground #75695E`, `--faint-foreground #A3978A`
   - `--primary #586D37`, `--primary-hover #4A5D2D`, `--primary-foreground #FFFFFF`
   - `--accent #E8EAD8`, `--accent-foreground #46562B`, `--selected #E8E2CF`
   - `--border #E2D8C8`, `--input #E2D8C8`, `--ring var(--primary)`
   - `--success var(--primary)`, `--destructive #B03A2E`, `--destructive-surface color-mix(in srgb, var(--destructive) 10%, transparent)`, `--info #4A6F86`
   - `--backdrop rgb(43 36 32 / 0.35)`
   - `--shadow-card` (the mockup's light `--shadow`)

   Also `color-scheme: light`.
4. **`.dark` (dark palette, the only place dark values appear):** the dark column of §4.1, plus a dark `--shadow-card`, `--backdrop rgb(0 0 0 / 0.5)`, and `color-scheme: dark`.
5. **`@theme inline`**, mapping each token into Tailwind:
   - **Colors:** `--color-background: var(--background)`, `--color-foreground`, `--color-card`, `--color-popover`, `--color-sidebar`, `--color-muted`, `--color-muted-foreground`, `--color-faint-foreground`, `--color-primary`, `--color-primary-hover`, `--color-primary-foreground`, `--color-accent`, `--color-accent-foreground`, `--color-selected`, `--color-border`, `--color-input`, `--color-ring`, `--color-success`, `--color-destructive`, `--color-destructive-surface`, `--color-info`, `--color-backdrop`. Names must match so shadcn components work (`bg-primary`, `text-muted-foreground`, `border-border`, …).
   - **Shadow:** `--shadow-card: var(--shadow-card)`.
6. **`@theme`** (static scale):
   - **Fonts:**
     - `--font-sans`: the system stack from the mockup
     - `--font-serif`: `"Iowan Old Style", Charter, "Palatino Linotype", Palatino, Georgia, serif`
     - `--font-mono`: `ui-monospace, "SF Mono", Menlo, monospace`
   - **Type scale (override Tailwind's):** `--text-2xs: 11px`, `--text-xs: 12px`, `--text-sm: 13px`, `--text-base: 14px`, `--text-lg: 16px`, `--text-xl: 20px`, `--text-2xl: 24px`, `--text-3xl: 28px`, plus `--text-title: 21px` (course title) and `--text-read: 17.5px` (reading). Give each a sensible `--text-*--line-height`.
   - **Weights:** use Tailwind's `font-normal` / `font-medium` / `font-semibold` (400/500/600) only.
   - **Radius:** `--radius-xs: 4px` (chips), `--radius-sm: 5px` (controls), `--radius-md: 6px` (cards, dialogs), `--radius-lg: 8px`, `--radius-xl: 12px` (app frame), `--radius-full: 9999px`.
   - **Layout/sizes:** `--spacing-sidebar: 14.75rem`, `--spacing-index: 15rem`, `--spacing-header: 52px`, `--spacing-actionbar: 44px`, `--spacing-row: 30px`, `--spacing-control: 28px`, `--spacing-control-lg: 38px`, `--container-reading: 40rem`. Use whatever Tailwind v4 namespace makes `w-sidebar`, `h-header`, `h-row`, `max-w-reading`, … work.
   - **Icons:** `--spacing-icon-sm: 14px`, `--spacing-icon: 16px`, so `size-icon` / `size-icon-sm` work.
   - **Motion:** `--ease-out-soft: cubic-bezier(.2,.7,.2,1)`, `--duration-fast: 120ms`, `--duration-panel: 200ms`. Use whatever namespace Tailwind v4 needs for `ease-*` / `duration-*` utilities, or plain custom properties if it has none, and document which.
   - **z-index:** `--z-dropdown`, `--z-drawer`, `--z-overlay`, `--z-dialog`, `--z-toast` (10/20/30/40/50).
7. **`@layer base`:**
   - `html, body` use `bg-background text-foreground font-sans text-sm antialiased`, height 100%.
   - Visible `:focus-visible` ring using `--ring`, 2px with offset.
   - `::selection` uses `--accent`.
   - Under `@media (prefers-reduced-motion: reduce)`, transitions and animations are disabled.
8. **`@layer components`, `.prose-arbor`.** Reading typography for markdown output from `src/domain/markdown.ts`, which produces `h1–h3`, `p`, `ul`/`ol`/`li`, `table`/`th`/`td`, `a` (incl. `[data-arbor-digest]`), `code`, `strong`, `em`, and elements with `[data-arbor-page]`. Values come from the mockup's `.doc` rules:
   - serif, `--text-read`, line-height 1.75, max-width `--container-reading`, centered
   - `h1`/`h2`: serif 500, ~2.2em / ~1.5em
   - `h3`: italic 500, 1.15em
   - paragraph and list spacing like the mockup
   - `li::marker` uses `--faint-foreground`
   - `strong` 600
   - `code` in mono 0.9em on `--muted` with radius-xs
   - links in `--primary` with an underline on hover
   - tables with hairline `--border` cells and a `--muted` header
   - `[data-arbor-page]` page marker styled like the mockup's plain chip (11–12px, faint, 1px border, radius-xs)

   **No raw hex in `.prose-arbor`;** only `var(--…)` tokens and theme sizes.
9. Nothing else in this file. No component classes beyond `.prose-arbor`.

## 2. Theme provider
- `src/stores/ui-store.ts` (zustand + `persist` to `localStorage` key `arbor.ui`): `{ appearance: Appearance ("system"|"light"|"dark"), setAppearance }`. Use `Appearance` from `~/domain/types` and `parseAppearance` from `~/domain/theme`. Later PRs add sidebar/log state here. PR 4 will sync `appearance` with worker settings; leave a `// PR 4: sync with get_settings/save_settings` note.
- `src/components/app/theme-provider.tsx`: `ThemeProvider`:
  - reads `appearance` from the store and resolves it with `resolvedTheme(appearance, matchMedia("(prefers-color-scheme: dark)").matches)` (existing `~/domain/theme`)
  - toggles the `dark` class on `document.documentElement` and sets `style.colorScheme`
  - subscribes to the `matchMedia` change event only while appearance is `system`
  - writes the resolved theme to `localStorage["arbor.theme"]`
  - use `useSyncExternalStore` for the media query rather than an effect that sets state (React Compiler lint rules)
- **No flash:** in `src/main.tsx`, *before* `createRoot`, synchronously read `localStorage["arbor.theme"]` (fall back to `matchMedia`) and apply the `dark` class. Don't use an inline `<script>` in `index.html` (CSP `script-src 'self'`). Wrap the app in `ThemeProvider`.
- Tests (`src/components/app/theme-provider.test.tsx`):
  - system + dark media gives the `dark` class
  - explicit light overrides a dark system setting
  - switching appearance updates the class
  - the system-change event updates it while on `system`

  Mock `matchMedia` in `src/test/setup.ts` if happy-dom lacks it.

## 3. Dev-only token sheet at `#/dev/ui`
- `src/routes/dev.ui.tsx`: route `/dev/ui`. The component renders `<DevGallery/>` only when `import.meta.env.DEV`; otherwise it renders a one-line "Not available in production builds." Load the gallery with `React.lazy(() => import("~/dev/gallery"))` inside the `import.meta.env.DEV` branch, so production builds tree-shake it. **Verify with `npm run build` and grep `dist/` for a unique string from the gallery: it must not appear.**
- `src/dev/gallery.tsx` (only Tailwind utilities that map to tokens; no hex, no arbitrary px):
  - a light/dark/system toggle using the ui-store (plain `<button>`s are fine here; `Button` arrives in PR 3)
  - **color swatches:** every color token, name plus swatch, using `bg-*` classes
  - the **type scale** (each `text-*` with its name) and serif/sans/mono samples
  - **radius** samples
  - **spacing/size** tokens as bars
  - **shadow** card sample
  - a **`.prose-arbor` sample**: render a markdown string through the existing `renderMarkdown` from `~/domain/markdown` with `dangerouslySetInnerHTML`, covering headings, a list, a table, a code span, a digest link, and a page marker
- Add a tiny link from the placeholder index page to `#/dev/ui`, shown only in dev.

## 4. Style guard: `scripts/check-styles.mjs` (in `desktop/`)
- Node script, no dependencies. Scans `src/**/*.{ts,tsx,css}` **excluding** `src/legacy/**`, `src/index.css`, `src/routeTree.gen.ts`, and `**/*.test.*`. `src/components/ui/**` is scanned but may be allowlisted per line later (PR 3).
- Fails (exit 1, printing `file:line: rule: snippet`) on:
  - hex colors `#[0-9a-fA-F]{3,8}\b` (outside import specifiers and URL fragments; keep the regex pragmatic)
  - `rgb(`, `rgba(`, `hsl(`
  - Tailwind arbitrary values with units or colors: `-\[[0-9.]+(px|rem|em)\]`, `-\[#`
  - `style={{` objects whose keys include `color`, `background`, `margin`, `padding`, `gap`, `fontSize`, `width`, or `height`
  - Unicode glyphs in `.tsx` text in the ranges `←-⯿` and emoji `\u{1F300}-\u{1FAFF}`, except the typographic `·`, `…`, `—`, `–`, `→`. The mockup uses `·` and `→` in copy; allow those.
- A per-line escape hatch: a trailing `// style-allow: <reason>` comment skips that line.
- `package.json`: `"check:styles": "node scripts/check-styles.mjs"`; add it to `"test"` (run it first). CI already runs `npm test`.
- A small node test or self-check: put fixture strings in `tests/check-styles.test.mjs` and assert each rule fires and that the allow comment works.

## 5. Acceptance (run all, report real results)
- `npm test`: node tests 113+ (plus the new check-styles test), vitest (theme tests + existing), and `check:styles` clean.
- `npm run lint` (0 warnings), `npm run build`.
- `grep` proves the gallery isn't in `dist/`.
- **No browser.** Claude will visually check `#/dev/ui` in light and dark against the mockup.

## Commit
Commits on `ui/02-tokens`, each ending `Co-Authored-By: Composer 2.5 <noreply@cursor.com>`. Don't push.

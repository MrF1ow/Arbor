# PR 1: Toolchain

Branch `ui/01-toolchain`, stacked on `feat/ui-react`. Master plan §2, §3, §11 row 1. Read `README.md` in this folder first (agent rules: **no browser, never launch the app window**).

## Goal
Add React 19 + React Compiler, Tailwind v4, the shadcn config, TanStack Router and Query, zustand, vitest + Testing Library, and ESLint, while keeping the legacy UI fully working in dev and every existing test passing. No visual design yet: tokens are PR 2 and components are PR 3.

## Work directory
`/home/flow/Projects/personal/Arbor/.worktrees/ui-stack/desktop` (run all npm commands here).

## Steps

### 1. Move the legacy UI aside (dev-only, still works)
- `git mv index.html legacy.html`.
- `git mv src/main.ts src/legacy/main.ts` and `git mv src/styles.css src/legacy/styles.css`.
- In `legacy.html`, update the stylesheet and script paths to `/src/legacy/styles.css` and `/src/legacy/main.ts`. Keep the asset paths (`/src/assets/...`) working: assets stay in `src/assets/`.
- Fix the relative imports inside `src/legacy/main.ts` (see step 2).
- `legacy.html` is not a Vite build input, so it never ships. It stays reachable in dev at `/legacy.html` for side-by-side comparison. Don't add it to `build.rollupOptions.input`.

### 2. Move pure modules to `src/domain/` (unchanged content)
- `git mv` these into `src/domain/`: `chat.ts citations.ts concepts.ts flashcards.ts library-role.ts markdown.ts provider.ts quiz.ts search-hit.ts study-writes.ts tauri.ts theme.ts types.ts`.
- Update the imports between them and in `src/legacy/main.ts`. Keep the existing `.ts` extension style where a file already uses it (e.g. `chat.ts` imports `./markdown.ts`).
- Don't edit their logic.

### 3. Update the existing tests for the new paths only
- In `tests/*.mjs`:
  - `../src/<module>.ts` → `../src/domain/<module>.ts`
  - `../src/main.ts` → `../src/legacy/main.ts`
  - `../src/styles.css` → `../src/legacy/styles.css`
  - `../index.html` → `../legacy.html`
- **Only path changes.** Don't rewrite assertions; those tests get replaced feature by feature in later PRs.
- `npm run test:node` (step 6) must stay green: same test count as before the move.

### 4. New dependencies (pin exact or caret, commit `package-lock.json`)
- **Runtime:** `react`, `react-dom` (19.x), `@tanstack/react-router`, `@tanstack/react-query`, `zustand`, `@base-ui/react`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`.
- **Dev:**
  - Build: `@vitejs/plugin-react`, `babel-plugin-react-compiler`, `@tailwindcss/vite`, `tailwindcss` (v4), `@tanstack/router-plugin`, `@types/react`, `@types/react-dom`.
  - Tests: `vitest`, `happy-dom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`.
  - Lint: `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks` (a version with the React Compiler rules), `globals`.
- Upgrade `typescript` and `vite` only if a new dependency requires it. Say so in the report if you do.

### 5. Config
- **`vite.config.ts`:** keep the existing Tauri server settings (port 1420, strictPort, HMR host, ignore `src-tauri`). Add plugins in this order:
  1. `tanstackRouter({ target: "react", autoCodeSplitting: true, routesDirectory: "src/routes", generatedRouteTree: "src/routeTree.gen.ts" })`
  2. `react(...)` with the React Compiler enabled (the babel plugin, configured the way the installed `@vitejs/plugin-react` version documents)
  3. `tailwindcss()`

  Add `resolve.alias` `~` → `/src`. Add a `test` block, or a separate `vitest.config.ts`: `environment: "happy-dom"`, `setupFiles: ["src/test/setup.ts"]`, `include: ["src/**/*.test.{ts,tsx}"]`.
- **`tsconfig.json`:**
  - `jsx: "react-jsx"`, `paths: { "~/*": ["./src/*"] }` (+ `baseUrl` if your TS version needs it), `types: ["vite/client"]`, `lib` adds `ES2022` if needed.
  - Keep `strict`, `noUnusedLocals`, and `noUnusedParameters`.
  - `include: ["src"]`, which still covers `src/legacy`. The legacy code must keep type-checking.
- **`components.json`** (shadcn, same shape as T3 Code's):
  - `style: "base-mira"`, `tsx: true`, `rsc: false`
  - `tailwind.css: "src/index.css"`, `baseColor: "neutral"`, `cssVariables: true`
  - `iconLibrary: "lucide"`
  - aliases `components: "~/components"`, `ui: "~/components/ui"`, `lib: "~/lib"`, `utils: "~/lib/utils"`, `hooks: "~/hooks"`
  - `registries: { "@coss": "https://coss.com/ui/r/{name}.json" }`

  If `npx shadcn@latest init` can run non-interactively with these values, use it. Otherwise write the file by hand. **Don't add any components yet** (PR 3).
- **`src/lib/utils.ts`:** `cn(...inputs)` = `twMerge(clsx(inputs))`.
- **`eslint.config.js`** (flat config): TS recommended rules, react-hooks recommended rules including the React Compiler rule, browser globals. Ignore `dist`, `src-tauri`, `src/legacy`, `src/routeTree.gen.ts`, and `tests`. Lint must pass with zero errors.

### 6. Scripts (`package.json`)
- `"dev": "vite"` (unchanged)
- `"build": "tsc && vite build"` (unchanged)
- `"test:node"`: the current node `--test` command
- `"test:unit": "vitest run"`
- `"test": "npm run test:node && npm run test:unit"`
- `"lint": "eslint ."`
- `"typecheck": "tsc --noEmit"`

### 7. New app skeleton
- **`index.html`** (new):
  - `<div id="root"></div>`
  - `<script type="module" src="/src/main.tsx"></script>`
  - same `<title>Arbor</title>` and favicon as legacy
  - **no inline `<script>` and no inline `style=`**. The CSP is `script-src 'self'`.
- **`src/index.css`:** `@import "tailwindcss";` plus a placeholder comment that tokens arrive in PR 2. Nothing else.
- **`src/main.tsx`:**
  - `createRoot(document.getElementById("root")!)`
  - render `<StrictMode>` > `<QueryClientProvider>` > `<RouterProvider>`
  - the router uses `createHashHistory()` and the generated `routeTree`, with `defaultPreload: "intent"`
  - imports `./index.css`
- **`src/router.ts`:** `getRouter(history)` plus the `Register` module augmentation, like T3 Code's `apps/web/src/router.ts`.
- **`src/routes/__root.tsx`:** renders `<Outlet />`.
- **`src/routes/index.tsx`:** a plain placeholder: an `<h1>` "Arbor 0.6 rebuild in progress" and a line saying the legacy UI is at `/legacy.html` in dev. Use semantic HTML only and no custom styling.
- **`src/routeTree.gen.ts`:** generated by the plugin during `vite build`. Commit it.
- **`src/test/setup.ts`:** imports `@testing-library/jest-dom/vitest`.
- **`src/routes/index.test.tsx`:** renders the app with a memory history and asserts the placeholder heading is present. This proves vitest + happy-dom + the router + the compiler work.

### 8. CI (`.github/workflows/test.yml`, `desktop` job)
Replace the run block with:
```
npm ci
npm test
npm run lint
npm run build
```
`npm run build` already includes `tsc`.

### 9. Docs
- `desktop/README.md`: a short "0.6 rebuild" note: the new entry is `index.html` → `src/main.tsx`, the legacy UI is at `/legacy.html` in dev, and how to run `npm test` / `npm run lint`.

## Acceptance (run all, report results)
- `npm ci && npm test`: node tests pass with the **same count as before the move**, and vitest passes.
- `npm run lint`: 0 errors.
- `npm run build`: passes.
  - `dist/index.html` has no inline `<script>`.
  - `dist/` contains no `legacy` chunk. Check with `grep -ri legacy dist/ || true` and report the output.
- `cargo test --manifest-path src-tauri/Cargo.toml` still passes (frontend changes shouldn't affect it; run it once).
- **Do not** run `tauri dev`, `tauri build`, `vite`, or any browser. Claude will check that both `index.html` and `legacy.html` render.

## Commit
One or a few commits on `ui/01-toolchain`, each ending with `Co-Authored-By: Composer 2.5 <noreply@cursor.com>`. Don't push.

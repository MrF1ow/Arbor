# PR 14a: Settings, part 1 (layout, General, Provider & models, Shortcuts)

Branch `ui/14a-settings-core`, stacked on `ui/13-jobs`.

Master plan §11 row 14 is split in two:
- **14a (this PR):** the settings shell, **General**, **Provider & models**, and **Shortcuts**
- **14b (next):** Library & sharing, Sync and conflicts, Skills, and Workers

Also see master plan §7.1 (the auth cache, `PROVIDER_FALLBACK`, never calling `list_providers`, the models cache rules) and Appendix B item 11. Read `README.md` in this folder first: **no browser, never launch the app window, never run `dev:mock`.**

- **Design:** the mockup has no settings page. Use the shell-page language from PR 13 Jobs:
  - a centered column, `ShellPageHeader`
  - `SettingsSection` / `SettingRow` composites (PR 3)
  - hairlines, `Switch` for toggles, `Select` for choices, `Input` plus a button for text settings
- **Legacy reference:** `desktop/legacy.html` ~284–346 (the settings markup and copy), and `desktop/src/legacy/main.ts`:

  | Legacy code | Line |
  |---|---|
  | `loadKnowledgeSettingsUi` | ~2899 |
  | `saveKnowledgeSettings` | ~2915 |
  | `syncProviderBaseUrlFromInput` / `refreshProviderExtraRows` / `refreshProviderKeyStatus` | ~2943–2978 |
  | `loadProviders` | ~2989 |
  | `loadSettings` | ~3002 |
  | `persist` | ~3047 |
  | `loadModels` | ~3068 |
  | the appearance handler | ~3233 |
  | the toggles | ~3312–3348 |
  | reindex | ~3656 |
  | the provider / key / base-URL / model handlers | ~3667–3740 |
  | `upsertProviderOverride` / `currentEffectiveProvider` / `refreshProviderRecommendationUi` / `applyEffectiveProviderForActiveRoot` | ~927–968 |
- **Existing data layer** (PR 4, reuse it):
  - `src/lib/queries/settings.ts`, `auth.ts`, `effective-provider.tsx`
  - `models` (`useModels`, `staleTime: Infinity`, invalidated only on provider change / root switch / refresh)
  - `providers` (static `PROVIDER_FALLBACK`)
  - the settings save mutation
  - `domain/provider.ts`

## Work directory
`/home/flow/Projects/personal/Arbor/.worktrees/ui-stack/desktop`

## 1. Settings shell (`routes/settings.tsx` layout + section routes)
- **Layout:** a centered column (`max-w-4xl`, the same alignment rules as Jobs: the header and content share a left edge).
- **Left:** a vertical section nav (`ListRow`s with icons):
  - General (`SlidersHorizontal`)
  - Provider & models (`Cpu`)
  - Library & sharing (`Users`)
  - Sync (`RefreshCw`)
  - Skills (`Puzzle`)
  - Workers (`Server`)
  - Shortcuts (`Keyboard`)
- **Right:** the section `<Outlet/>`.
- **Narrow** (`jobs` breakpoint or similar, < 56rem): the nav becomes a horizontal scrollable tab row above the content.
- **Routes:** `/settings` → redirect to `/settings/general`; `/settings/general`, `/settings/provider`, and `/settings/shortcuts` (this PR). `/settings/library`, `/settings/sync`, `/settings/skills`, and `/settings/workers` render a simple "Coming in the next PR" `EmptyState` (PR 14b replaces them).
- **Mod+,** opens Settings (already in the catalog), landing on General.
- Header: "Settings", with the legacy description "Appearance, Knowledge folder behavior, provider, and model selection."

## 2. General (`/settings/general`)
- **Appearance:** a `Select` (System / Light / Dark). It updates the theme immediately (`ThemeProvider` / ui-store) and persists to settings `appearance`, as legacy `persist` did. "System" follows the OS. This already exists in PR 2/4 (appearance sync); wire it, don't duplicate it.
- **Knowledge folder** (only when there's an active root; otherwise show the "Choose a Knowledge folder first" hint plus the Choose action): one `Switch` row each, with the legacy copy:
  - "Watch folder for new files" (`watch_enabled`)
  - "Auto-run after watch" (`auto_update`)
  - "Embed after Update" (`auto_embed`)
  - "Delete sources after digest" (`delete_sources_after_digest`)
  - "Auto-generate flashcards after Update" (`auto_generate.flashcards`)
  - "Auto-generate quiz after Update" (`auto_generate.quiz`)
  
  Read them via `get_knowledge_settings`. Save with the legacy **read-merge-write** (`saveKnowledgeSettings`: read current, then merge the partial, including a deep merge of `auto_generate`, then `save_knowledge_settings`), optimistically, with rollback and a toast on failure. Add a query hook and a mutation if they're missing. Toggling **Watch** also (re)starts or stops the folder watch, if legacy did; check `start_folder_watch` usage.
- **Search index:** a "Reindex" button → `reindex_knowledge { root }`. Busy spinner; then `toast.success("Reindexed N document(s).")` plus the job-log line `Reindexed N document(s).`; on failure, the log line `Reindex failed: …` plus a toast. Invalidate the search queries.

## 3. Provider & models (`/settings/provider`)
- **Provider:** a `Select` from `PROVIDER_FALLBACK` (via `pickerProviders`, as legacy did). **Never call `list_providers`** (§7.1; there's an existing test asserting this, so keep it passing).
- **Library recommendation:** when the active root's library sets a provider (`library_show` → `provider`), show the faint note "recommended by library" (legacy `provider-recommendation`). Changing the provider or model then writes a **per-root override** (`upsertProviderOverride(root, provider, model)` into `settings.provider_overrides`) instead of the global `provider_id`/`model_id`, exactly as legacy did (~3667, ~3727). Port `effectiveProvider` usage from `domain/provider.ts`; the effective provider hook already exists.
- **API key** (only for `openai_api` / `anthropic_api`):
  - a password `Input`, **Save key** → `set_provider_secret { providerId, secret }` (clears the input), and **Clear key** → `clear_provider_secret { providerId }`
  - status from `provider_secret_status`: "ready" vs "key missing"
  - after save or clear, refresh the status and re-check auth (forced)
  - on errors, the log line `Could not save API key: …` / `Could not clear API key: …` plus a toast
- **Base URL** (only for `ollama` / `lmstudio`): an `Input` with the legacy placeholders `http://127.0.0.1:11434` / `http://127.0.0.1:1234/v1`. On change (blur/Enter): persist `ollama_base_url` / `lmstudio_base_url` and invalidate that provider's models cache.
- **Model:** a `Select` from `useModels(provider, root)`, plus a **Refresh models** icon button (forces a refetch). The selection follows the legacy rule: keep the previous model if it's still listed, otherwise the first. On change: persist (or override), then re-check auth.
- **Auth status line:** reuse the sidebar provider-status semantics (signed in / checking / signed out with reason / worker unavailable, plus the docs link if legacy showed one). After a provider change, force an auth check (`fetchAuthStatus(provider, true)`, legacy `refreshAuth({ force: true })`). Respect the 60 s cache otherwise; **opening Settings must not trigger an auth probe** (§7.1 — there's a test; keep it).
- Every write goes through the settings save mutation with the full settings object (legacy `persist` writes everything). Make sure you don't clobber `knowledge_roots`, `workers`, `skill_*`, etc.: read-modify-write from the settings query data.

## 4. Shortcuts (`/settings/shortcuts`)
Render the exported shortcut catalog (`lib/shortcuts.ts`) grouped by `group` (General / Flashcards / Quiz / Graph / …). Each row shows the action label plus a `Kbd` chord, rendered per platform (⌘ vs Ctrl). Read-only.

## 5. Tests (vitest; delete `tests/provider-ui.test.mjs`, porting its intent)
- **Settings nav:** the redirect to General; each link routes; Mod+, opens Settings.
- **General:**
  - appearance select → the theme class changes and `save_settings` is called with `appearance`
  - each knowledge toggle → `save_knowledge_settings` with the merged object (`auto_generate` keeps the other key)
  - a failure rolls the toggle back and shows a toast
  - Reindex → `reindex_knowledge`, the toast, and the log line
  - no root → the hint
- **Provider:**
  - the select lists `PROVIDER_FALLBACK` labels; `list_providers` is never invoked
  - switching to `openai_api` shows the key row; Save key → `set_provider_secret` (then the input clears, the status says "ready")
  - Clear key → `clear_provider_secret`
  - switching to `ollama` shows the base URL with its placeholder; a change persists `ollama_base_url`
  - a model change persists `model_id`
  - with a library provider present: the "recommended by library" note shows, and a provider or model change writes `provider_overrides` for the root, not the global ids
  - a provider change forces `check_auth { force: true }`
  - opening Settings makes **no** `check_auth` call when it was checked under 60 s ago
- **Shortcuts:** groups and chords render; the platform label switches.
- **Render-audit test:** add the `/settings/*` routes.

## 6. Acceptance (run all, report real results)
- `npm test`: paste the tail with `EXIT=$?` and the count of "Unhandled" (must be 0).
- `npm run lint`, `npm run build` (entry ≤ 250 KB; settings is code-split).
- **Needs visual check (Claude):**
  - settings at 700/1100/1600, light and dark
  - nav and active state
  - the toggle rows
  - the provider rows switching per provider (key / base URL)
  - the shortcuts table

## Commit
Focused commits on `ui/14a-settings-core`, each ending `Co-Authored-By: Composer 2.5 <noreply@cursor.com>`. Don't push. Don't create or link pull requests.

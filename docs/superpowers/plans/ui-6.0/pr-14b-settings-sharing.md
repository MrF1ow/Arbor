# PR 14b: Settings, part 2 (Library & sharing, Sync and conflicts, Skills, Workers)

Branch `ui/14b-settings-sharing`, stacked on `ui/14a-settings-core`. It completes master plan §11 row 14 and Appendix B item 11 (library / sync / skills / workers), and replaces the four placeholder sections from 14a. Read `README.md` in this folder first: **no browser, never launch the app window, never run `dev:mock`.**

- **Design:** the 14a settings language: `SettingsSection` / `SettingRow`, `Switch`, `Select` (with `items` labels), and `Input` plus a button. Dialogs use the `components/ui/dialog` styles (serif title, footer actions) and are lazy-loaded.
- **Legacy reference:**
  - `desktop/legacy.html`: ~346–466 (the Sync, Library, Skills, and Workers groups) and the dialogs ~492–539 (sync conflict, library create, library join)
  - `desktop/src/legacy/main.ts`:

  | Area | Legacy code |
  |---|---|
  | Library | `refreshLibraryShow` ~970, `renderLibrarySettingsUi` ~1017, `refreshLibraryRoleNotes` ~601, `setViewerWriteButtonState` ~620; create ~3412, join ~3448, member add ~3509, members save ~3519, provider save/clear ~3540–3585 |
  | Sync | `refreshSyncUi` ~2117; the handlers ~3348–3389; the conflict dialog `renderSyncConflictFileDetail` ~2548, `renderSyncConflictSession` ~2566, `openSyncConflictDialog` ~2597, `reloadSyncConflictDialog` ~2611, `reloadLibraryAfterSync` ~2619, `runSyncNow` ~2627; the conflict handlers ~3586–3655 |
  | Skills | `refreshSkillsUi` ~2154, `skillPermissionsMatch` / `skillGrantFor` ~2380, `renderSkillPackages` ~2390, `saveSkillIndexSettings` ~2459, `browseSkillIndex` ~2466, `installSkillPackage` ~2477, `confirmSkillPermissions` ~2486, `runSkillPackage` ~2499, `uninstallSkillPackage` ~2535; the handlers ~3390–3397 |
  | Workers | `generateWorkerId` ~2159, `parseWorkerPort` ~2163, `readWorkerFromForm` ~2171, `clearWorkerForm` / `fillWorkerForm` ~2205–2228, `renderWorkerList` ~2229, `renderWorkerRoots` ~2262, `setRootWorker` ~2299, `saveWorkerFromForm` ~2313, `removeWorker` ~2343, `testWorkerConnectionFromForm` ~2365; the handlers ~3398–3411 |
- **Existing hooks to reuse:**
  - `lib/queries/library.ts`: `useLibrary`, `useLibrarySetMembersMutation`, `useLibrarySetProviderMutation`, `useCreateSharedLibraryMutation`, `useJoinLibraryMutation`
  - `lib/queries/sync.ts`: `useSyncState`, `useSyncConflict`, set remote / shared / now / continue / resolve
  - `lib/queries/skills.ts`
  - `useTestWorkerConnectionMutation`
  - the serialized settings save from 14a (`saveSettingsSerialized`): **every settings write goes through it**
- **Pure helpers:** keep or move them to `src/domain` with tests: `domain/library-role.ts`, `workers-persist` (there's an existing test), and the skill permission helpers.

## Work directory
`/home/flow/Projects/personal/Arbor/.worktrees/ui-stack/desktop`

## 1. Library & sharing (`/settings/library`)
- **No active root:** the hint plus the Choose action.
- **No library** (`library_show.present === false`):
  - **Create shared library** opens a dialog (port the legacy `library-create-dialog` fields and copy) → `create_shared_library`
  - **Join a library** opens a dialog (port `library-join-dialog`) → `join_library` (the exact payload is in PR 4 / Appendix A)
  - on success: invalidate the library, courses, sync, and settings; toast; and re-run the effective-provider apply
- **Library present:**
  - your role (owner / editor / viewer) as a badge
  - **Members:** a list of email + role. Owners get a role `Select` per member and an **Add member** row (email `Input` plus a role `Select` plus Add); **Save members** → `library_set_members`. Non-owners see read-only roles and the note "Only an owner can edit library members." (legacy copy). Validate the email format; show inline errors.
  - **Library provider:** provider id plus model inputs (owner or editor only). Ideally a `Select` from `PROVIDER_FALLBACK` plus a model input, but keep the legacy semantics. **Save provider** / **Clear provider** → `library_set_provider` (the exact payload is in PR 4: id / model / clear). On success: invalidate the library and re-apply the effective provider. The Provider page's "recommended by library" note updates.
- **The viewer write-block note** (legacy `library-role-note-settings`): show `VIEWER_WRITE_REASON` for viewers.

## 2. Sync (`/settings/sync`)
- **Arbor remote:** an `Input` (placeholder `git@host:repo.git`) plus **Save remote** → `sync_set_remote { url }`, then show `remote_note` from `sync_show`.
- **Shared library (merge on sync):** a `Switch` → `sync_set_shared`.
- **Sync after each committed job:** a `Switch`, a knowledge setting (`sync_after_commit`), saved through the 14a read-merge-write.
- **Manual sync:** a **Sync now** button → `sync_now`, with a busy spinner and a status line (legacy `sync-status` copy). On conflicts, open the **conflict dialog**.
- **Conflict dialog** (port the legacy `sync-conflict-dialog`), `components/settings/sync-conflict-dialog.tsx`, lazy:
  - the file list on the left (the existing `ListRow`; each file shows its status)
  - **text conflicts:** "Mine" and "Theirs" side by side (mono, scrollable), a "Resolved text" `Textarea`, and **Use mine** / **Use theirs** / **Use this text** → `sync_resolve` with the right payload
  - **binary conflicts:** the legacy binary message plus Use mine / Use theirs
  - errors inline (`sync-conflict-error`)
  - footer: **Close** and **Continue sync** → `sync_continue`
  - after a resolve, reload the session (`read_sync_conflict`) and focus the next unresolved file
  - after a continue succeeds: close, toast, and `reloadLibraryAfterSync` (invalidate courses, digests, and so on)
  - also openable from a sync failure toast's action ("Resolve conflicts")
- After any sync: invalidate the library and course queries, as legacy `reloadLibraryAfterSync` did.

## 3. Skills (`/settings/skills`)
- **Index source** `Input` (placeholder "Default: marketplace/index.json in this repo") and **Index ref** `Input` (placeholder "Branch, tag, or commit"), plus **Save index**: persist `skill_index_source` / `skill_index_ref` via the serialized settings save.
- **Browse index:** loads `skill_index` and renders package cards: name, description, version, permissions chips, and installed state.
  - Actions per package: **Install** (→ `skill_install`), **Run** (→ `skill_run`), **Uninstall** (→ `skill_uninstall`, with a confirm).
  - **Permissions:** before install or run, if the package's permissions don't match the saved grant (`skillGrantFor` / `skillPermissionsMatch`), show a **confirm dialog** listing them (port `confirmSkillPermissions`). Accepting persists `skill_grants` (serialized save).
  - The status line `skill-status` uses the legacy copy; errors get a toast.

## 4. Workers (`/settings/workers`)
- **Worker list:** one row per SSH worker (label, `user@host:port`), with **Edit** (fills the form) and **Remove** (confirm → `removeWorker`, which also clears any root assignments; legacy ~2343).
- **Form:** Label, Host, Port (placeholder 22, validated with `parseWorkerPort`), User, Identity file (placeholder "/absolute/path/to/key"), Worker command (placeholder "uv run --project /path/to/python arbor-worker"), and Remote root.
  - **Add worker** / **Save worker** (when editing; legacy toggled the label), plus **Test connection** → `test_worker_connection`, with the status line (`worker-status` copy).
  - Save persists `workers` through the serialized settings save.
  - Inline field errors (legacy `readWorkerFromForm` validation messages, verbatim).
- **Per-root worker assignment** (legacy `renderWorkerRoots`): for each knowledge root, a `Select` "Local" plus each worker → `setRootWorker`, which persists the root's `worker_id` in `knowledge_roots` through the serialized save.

## 5. Tests (vitest; delete `tests/library-role.test.mjs`, `tests/library-ui.test.mjs`, `tests/library-ui-shared.test.mjs`, `tests/sync-ui.test.mjs`, `tests/skills-ui.test.mjs`, `tests/workers-ui.test.mjs`, porting their intent; keep `tests/workers-persist.test.mjs` if it tests pure logic)
- **Library:**
  - create and join dialogs → the exact payloads, with invalidations
  - owner sees member editing; Save members → `library_set_members` with the roles
  - editor/viewer: read-only, with the owner-only note
  - library provider save/clear → `library_set_provider` payloads, and the Provider page note updates
  - viewer: the write-block note
  - email validation
- **Sync:**
  - save remote → `sync_set_remote`, and the `remote_note` shows
  - the shared switch → `sync_set_shared`
  - sync-after-commit → the knowledge-settings merge
  - Sync now → `sync_now`, then the status
  - the conflict path opens the dialog
- **Conflict dialog:**
  - text: Use mine / Use theirs / Use this text → `sync_resolve` payloads, then a reload, then focus moves to the next file
  - binary: the message plus the two buttons
  - an error renders inline
  - Continue → `sync_continue`, then close, then the library reload
- **Skills:**
  - save index persists the settings fields (others preserved)
  - Browse renders packages
  - Install with mismatched permissions → the confirm dialog → accept persists `skill_grants`, then `skill_install`
  - Run and Uninstall (with confirm)
- **Workers:**
  - add with valid data → `save_settings` contains the worker (others preserved)
  - invalid port → the legacy error
  - Edit fills the form and saves
  - Remove (confirm) also clears root assignments
  - Test connection → `test_worker_connection`, then the status
  - the per-root select persists `worker_id`
- **Data safety:** each settings write in this PR preserves the unrelated fields (`provider_overrides`, base URLs, appearance, `skill_*`, `workers`, `knowledge_roots`).
- **Render-audit test:** the four routes, with real content (mock data with a library present, conflicts, packages, and workers).
- **Mock IPC:** realistic `library_show` (owner with 3 members; a variant for viewer), `sync_show`, `sync_now` returning a conflict session, `read_sync_conflict` (1 text plus 1 binary file), `skill_index` (3 packages: 1 installed, 1 with new permissions), and workers in settings. All stateful and reset in teardown.

## 6. Acceptance (run all, report REAL results)
- `npm test`: paste the tail with `EXIT=$?` and the `grep -c Unhandled` count (must be 0). Run it 3 times.
- `npm run lint`, `npm run build` (entry ≤ 250 KB; the dialogs and sections are code-split).
- **Needs visual check (Claude):**
  - the four sections at 700/1100/1600, light and dark
  - the member editing
  - the conflict dialog (text and binary)
  - the skill cards
  - the permission confirm
  - the worker form and list

## Commit
Focused commits on `ui/14b-settings-sharing`, each ending `Co-Authored-By: Composer 2.5 <noreply@cursor.com>`. Don't push. Don't create or link pull requests.

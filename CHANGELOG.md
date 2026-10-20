# Changelog

Package version for the worker, desktop, and Tauri app. See [Version numbering](PROJECT.md#version-numbering) in `PROJECT.md`.

**Version 2** is complete at `v2.0.0` (tagged). **Version 3** is complete as package `3.0.0`. **Version 4** is complete as package `4.0.0`. **Version 5** is complete as package `5.0.0`. **Current package:** `5.16.0`. **Current tag:** `v5.16.0`. `v5.0.1` is cut when that release lands. `v5.0.0` is cut when that release lands. `v4.5.0` is cut when that release lands. `v4.4.0` is tagged. `v4.3.0` is not tagged yet. `v4.2.0` is tagged. `v4.1.0` and `v4.0.0` are tagged. `v3.0.0` through `v3.5.0` are already tagged. The 2026-09-20 Mac batch (issue [#57](https://github.com/MrF1ow/Arbor/issues/57)) was retested on the 2026-10-17 Linux live run.

## Unreleased

Nothing pending above `5.16.0`.

## 5.16.0 — 2026-10-20

Git tag `v5.16.0`. **Product:** step toward Version 6. Worker, desktop, and Tauri report `5.16.0`. UI cutover stays `6.0.0`.

- Adds the settings shell for general, provider and models, and shortcuts.

## 5.15.0 — 2026-10-20

Git tag `v5.15.0`. **Product:** step toward Version 6. Worker, desktop, and Tauri report `5.15.0`. UI cutover stays `6.0.0`.

- Adds the jobs page, a live log tail, and job skill labels.

## 5.14.0 — 2026-10-20

Git tag `v5.14.0`. **Product:** step toward Version 6. Worker, desktop, and Tauri report `5.14.0`. UI cutover stays `6.0.0`.

- Adds the search palette.

## 5.13.0 — 2026-10-20

Git tag `v5.13.0`. **Product:** step toward Version 6. Worker, desktop, and Tauri report `5.13.0`. UI cutover stays `6.0.0`.

- Adds chat with streaming, citations, and explain-weakest.

## 5.12.0 — 2026-10-20

Git tag `v5.12.0`. **Product:** step toward Version 6. Worker, desktop, and Tauri report `5.12.0`. UI cutover stays `6.0.0`.

- Adds the concept graph and a shared study-job launcher.

## 5.11.0 — 2026-10-20

Git tag `v5.11.0`. **Product:** step toward Version 6. Worker, desktop, and Tauri report `5.11.0`. UI cutover stays `6.0.0`.

- Adds quiz and the shared study components.

## 5.10.0 — 2026-10-20

Git tag `v5.10.0`. **Product:** step toward Version 6. Worker, desktop, and Tauri report `5.10.0`. UI cutover stays `6.0.0`.

- Adds flashcards, including grades that advance before the save finishes.

## 5.9.0 — 2026-10-20

Git tag `v5.9.0`. **Product:** step toward Version 6. Worker, desktop, and Tauri report `5.9.0`. UI cutover stays `6.0.0`.

- Adds notes, the Overview landing page, the reading pane, and make-card.

## 5.8.0 — 2026-10-20

Git tag `v5.8.0`. **Product:** step toward Version 6. Worker, desktop, and Tauri report `5.8.0`. UI cutover stays `6.0.0`.

- Adds welcome, first-run folder choice, and the file-review dialog.

## 5.7.0 — 2026-10-20

Git tag `v5.7.0`. **Product:** step toward Version 6. Worker, desktop, and Tauri report `5.7.0`. UI cutover stays `6.0.0`.

- Adds the app shell: sidebar, course header, action bar, log drawer, and routes.

## 5.6.0 — 2026-10-20

Git tag `v5.6.0`. **Product:** step toward Version 6. Worker, desktop, and Tauri report `5.6.0`. UI cutover stays `6.0.0`.

- Adds the desktop data layer: typed IPC, queries, events, and mock mode.

## 5.5.0 — 2026-10-20

Git tag `v5.5.0`. **Product:** step toward Version 6. Worker, desktop, and Tauri report `5.5.0`. UI cutover stays `6.0.0`.

- Adds shared component primitives on Arbor Paper tokens.

## 5.4.0 — 2026-10-20

Git tag `v5.4.0`. **Product:** step toward Version 6. Worker, desktop, and Tauri report `5.4.0`. UI cutover stays `6.0.0`.

- Adds Arbor Paper tokens, the theme, prose styles, and the style guard.

## 5.3.0 — 2026-10-20

Git tag `v5.3.0`. **Product:** step toward Version 6. Worker, desktop, and Tauri report `5.3.0`. UI cutover stays `6.0.0`.

- Adds the React 19 toolchain (compiler, Tailwind v4, TanStack, vitest). The previous UI stays at legacy.html.

## 5.2.0 — 2026-10-20

Git tag `v5.2.0`. **Product:** step toward Version 6. Worker, desktop, and Tauri report `5.2.0`. UI cutover stays `6.0.0`.

- Documents the 6.0 UI rebuild plan and the Arbor Paper design. App behavior is unchanged.

## 5.1.0 — 2026-10-18

Git tag `v5.1.0` when this release lands. **Product:** performance and responsiveness for the desktop study loop ([#97](https://github.com/MrF1ow/Arbor/issues/97)). Worker, desktop, and Tauri report `5.1.0`, including `arbor-worker --version`.

- Worker commands no longer block the UI thread; short reads use a persistent `arbor-worker serve` process and the bundled worker ships as onedir for faster cold starts.
- Sign-in status is cached for 60 seconds in the app (no background polling); only the provider you selected is checked, not every backend.
- Flashcard and quiz answers advance immediately while grades save in the background with retry and a visible **unsaved · Retry** state if saving fails.
- Course overview loads due cards, weak topics, and recommendations in one call.

## 5.0.1 — 2026-10-18

Git tag `v5.0.1` when this release lands. **Product:** macOS patch for the shipped Version 5 line. Worker, desktop, and Tauri report `5.0.1`, including `arbor-worker --version`.

- Disable hardened runtime on ad-hoc macOS DMG builds so the PyInstaller `arbor-worker` sidecar can load its extracted Python framework ([#95](https://github.com/MrF1ow/Arbor/issues/95)).
- CI smoke-tests the signed `.app` / DMG (`arbor-worker --version` and `list-providers`) before upload or release publish.
- Broaden GUI-launched PATH discovery (login-shell capture on macOS plus shared home install dirs) so provider CLIs installed outside `/usr/bin` resolve.
- Surface worker startup failures in Settings auth check as **Arbor worker unavailable** instead of a generic auth failure.

## 5.0.0 — 2026-10-18

Git tag `v5.0.0` when this release lands. **Product:** Version 5 (collaboration) is closed. Worker, desktop, and Tauri report `5.0.0`, including `arbor-worker --version`. The Linux live run is in `docs/superpowers/plans/2026-10-17-roadmap-completion/linux-live-run.md` (boxes C1–C6).

- A head-changing sync always reindexes and embeds, including when `.arbor/vectors.sqlite` does not exist yet. Derived vector files stay gitignored. The first pull on another machine rebuilds semantic search instead of leaving it empty.
- Live run: shared import and sync, a markdown conflict resolved in the dialog, and per-user flashcard progress that survives a round trip. Viewer role disables write controls and the worker refuses the write. A private sshd on localhost digested a PDF and the local tree committed the digest. `~/.ssh` was not modified.
- The Anki marketplace skill installed, confirmed, and uninstalled from a local bare index. The folder picker still does not accept Open under Xvfb (issue #70), so the TSV was not written on this run. Issue #88 stays open. Both are carried in the roadmap after Version 5.

## 4.5.0 — 2026-10-18

Git tag `v4.5.0` when this release lands. **Product:** remote workers over SSH. Version 5 continues at `v4.6.0`. Worker, desktop, and Tauri report `4.5.0`, including `arbor-worker --version`.

- Course jobs use **Local** or **SSH** transport. Local runs `arbor-worker` on this machine as before. SSH rsyncs course sources up, runs the same worker remotely with `--no-commit`, streams NDJSON events over `ssh`, rsyncs digests and study artifacts back, then Arbor commits on the local Knowledge tree.
- Settings → **Workers** lists saved SSH hosts (id, label, host, port, user, identity file, remote worker command, remote Knowledge root). **Test connection** runs `arbor-worker --version` on the host.
- Each knowledge root picks **Local** (default) or one saved worker. Provider overrides and library roles from `4.4.0` stay independent of worker choice.
- Host keys are stored in an Arbor-managed `known_hosts` file under app data (`StrictHostKeyChecking accept-new`). A changed key is refused with a clear error instead of updating silently.
- Cancel on an SSH job uses `ssh -tt` so a hang-up reaches the remote session.

## 4.4.0 — 2026-10-18

Git tag `v4.4.0` is tagged. **Product:** library roles and shared provider profiles. Version 5 continues at `v4.5.0`. Worker, desktop, and Tauri report `4.4.0`, including `arbor-worker --version`.

- `.arbor/library.json` members are `{email, role}` with roles `owner`, `editor`, and `viewer`. A v4.2 string list still loads: `created_by` becomes owner and the other addresses become editor. The signed-in role is the effective git email, the same lookup as per-user progress.
- Viewers cannot run write jobs (update, generate, study plan, make-card, skill runs that declare a write permission, and commits other than their own progress) or push on sync. Settings and the course actions disable those controls and show the reason. The worker refuses them as well. Viewers can still read, search, chat, and record their own progress. Owners edit members and roles in Settings → Library, which writes `library.json` and commits that file.
- Arbor's role check is advisory. The git host's permissions are what actually enforce access. Arbor cannot stop someone who pushes with git directly.
- A library may set `provider` to `{id, model}`. That is the recommended provider for the library. No API keys, tokens, or other credentials are written to `library.json`. When that root is active and the member has no local override, the provider picker selects it and shows "recommended by library". An override is stored in app settings for that root only.

## 4.3.0 — 2026-10-18

Git tag `v4.3.0` when this release lands. **Product:** skill packages and marketplace. Version 5 continues at `v4.4.0`. Worker, desktop, and Tauri report `4.3.0`, including `arbor-worker --version`.

- A skill package is `arbor-skill.json` (`id`, `version`, `kind: "skill"`, `entry`, `inputs`, `outputs`, `permissions`) plus a pure-Python module. Permissions are the closed set `read_course`, `write_course_study`, `write_export_dir`, `provider`, `network`. Unknown keys or permissions are rejected. v4.3.0 packages are stdlib-only. Install does not import the package and does not run setup.py or pip.
- Install takes a git URL and a full 40-hex commit (branch names are refused), with an optional `subdir`, into `$XDG_DATA_HOME/arbor/skills/<id>/<commit>/`. The id matches `^[a-z0-9][a-z0-9-]{0,63}$`. Path traversal and symlinks that leave the package directory are refused. The checked-out commit must equal the pin.
- A skill runs only after the user confirms its declared permissions for that id and commit. A new commit needs a new confirmation. The worker starts a child process with a temp home and no API keys unless the grant includes `provider`. The skill receives `read_course_file`, `write_export`, and `write_study_file`. Those methods refuse paths outside the granted dirs. This is not an OS sandbox: `open()`, sockets, and the `network` permission are not blocked by the operating system. Uninstall removes the install directory and the desktop confirmation.
- The marketplace is the static `marketplace/index.json` in this repo (`packages[]` with `kind` `skill` or `provider`). No separate marketplace repo. Settings → Skills stores an index source and ref, browses the index, shows permissions before install, installs, confirms, runs against the current course, and uninstalls. Provider rows are listed and are not installed. The index ref may be a branch. Each package `commit` is still a full SHA.
- First-party package `anki-export` writes an Anki-importable TSV (`anki-export.tsv`) of the shared deck `study/flashcards.json`. There is no `.apkg`. Permissions are `read_course` and `write_export_dir`. The index pins commit `429d15dc5a6fde7c61559fc787a737cd0c94414d` (the commit that added the package). The index row’s `git` URL is `https://github.com/MrF1ow/Arbor.git`. Offline installs use a local bare repo whose index `git` field is a `file://` URL.

## 4.2.0 — 2026-10-18

Git tag: `v4.2.0` is tagged. **Product:** shared libraries and team workspaces. Version 5 continues at `v4.3.0`. Worker, desktop, and Tauri report `4.2.0`, including `arbor-worker --version`.

- Sync hardening: a job commit includes only the paths that job wrote, so a file the user staged by hand stays staged. The fallback identity Arbor <arbor@localhost> applies to the committer even when only an author email is set. The conflict list marks a file resolved after Mine or Theirs. When origin and arbor have the same URL, Arbor syncs origin; when both exist and the URLs differ, Settings says Arbor syncs the arbor remote.
- Team workspaces: app settings hold a list of Knowledge roots, each personal or shared, plus the active root, migrated from the old single knowledge_root. The sidebar groups courses by root and switching is one click. Watcher, search, jobs, and chat follow the active root.
- Shared libraries: `.arbor/library.json` (name, members, created_by) is tracked in git. Create requires an arbor remote, writes that file, marks the root shared, and commits only that path. Join clones a git URL into an empty folder, adds the arbor remote, and marks it shared. Personal roots still rebase. A shared root, or a root with a valid library.json, merges on sync.
- Per-user state: study progress is `.arbor/users/<git-email>/<course>/progress.json` and is committed. Chat history and the flashcard/quiz UI counts live under that user's chat/ and local/ directories and stay gitignored. The email is the effective user.email, or arbor@localhost. A legacy `<course>/study/progress.json` is copied into the new path and kept as progress.json.bak.

## 4.1.0 — 2026-10-18

Git tag: `v4.1.0` is tagged. **Product:** First Version 5 slice (git remote sync). Version 5 continues at `v4.2.0`. Worker, desktop, and Tauri report `4.1.0`, including `arbor-worker --version`.

- Knowledge commits use `Arbor <arbor@localhost>` when git has no `user.email`, and the UI says so ([#80](https://github.com/MrF1ow/Arbor/issues/80)).
- Study plan, make-card, and study progress commit through the same helper ([#81](https://github.com/MrF1ow/Arbor/issues/81)).
- Settings → Sync: an `arbor` git remote per Knowledge root, **Sync now**, and optional sync after each committed job. Sync fetches, rebases (merge when the root is marked shared), and pushes. Conflicts abort to a clean HEAD and are resolved per file as mine, theirs, or an edit. Markdown and other text only; binary conflicts are refused. Derived files (`_arbor_cache/`, `.arbor/*.db`, the vector DB, `.arbor/chat/`) are gitignored and a pull rebuilds the search index and embeddings when a vector DB already exists. Credentials stay in the user's git/ssh config. Arbor stores none. Git errors are shown with embedded URL passwords redacted.

## 4.0.0 — 2026-10-18

Git tag: `v4.0.0` when this release lands. **Product:** Version 4 shipped. Version 5 is in progress (next package `v4.1.0`). Worker, desktop, and Tauri report `4.0.0`, including `arbor-worker --version`.

Linux live run recorded in [linux-live-run.md](docs/superpowers/plans/2026-10-17-roadmap-completion/linux-live-run.md). Boxes T1–T7 passed on a fresh fixture course, Saltmarsh, because Behavioral Medicine was not available. No product fix came out of the run.

- A covered question returns a concise answer. The digest/page chip opens Notes at the heading (T1).
- An uncovered question shows **Not supported by this course** (T2).
- Explain and Quiz stay inside the course. The turn after a quiz answer grades it and does not ask a new question (T3).
- Chat history survives a restart. New chat and Clear history work (T4).
- Chat leaves the Knowledge tree clean apart from `.arbor/` (T5).
- Due today, weak topics, the study plan, and make-card-from-selection work on a course ingested in the same run (T6).
- A signed-out Grok provider shows **Grok · not signed in** on the Chat tab (T7).

## 3.5.0 — 2026-10-18

Git tag: `v3.5.0` is tagged. **Product:** Version 4 in progress (API and local providers), not `v4.0.0`. Worker, desktop, and Tauri report `3.5.0`, including `arbor-worker --version`.

- Settings adds **Ollama**, **LM Studio**, **OpenAI API**, and **Anthropic API** as providers alongside the existing CLI options.
- OpenAI and Anthropic API keys are entered in Settings, stored in the OS keyring, and passed to the worker only as environment variables at process spawn. Keys are never written to `.arbor`, `settings.json`, job history, or argv.
- The API key field is masked; **Save key** and **Clear key** update the keyring without reading the secret back into the UI.
- The provider badge shows **key missing** or **ready** for API providers and **not running** for local servers when appropriate.
- Anthropic API is refused with a clear reason when Arbor runs inside a Claude Code session (`CLAUDECODE`).
- The desktop app sets `ARBOR_ALLOW_REMOTE_API=1` for the worker only when OpenAI API or Anthropic API is selected and a key is saved in the keyring.

## 3.4.0 — 2026-10-17

Git tag: `v3.4.0` when this release lands. **Product:** Version 4 in progress (study plans, recommendations, and make-card-from-selection), not `v4.0.0`. Worker, desktop, and Tauri report `3.4.0`, including `arbor-worker --version`.

- `arbor-worker study-plan` writes `<course>/study/plan.md` from weak topics, due counts, and an optional exam date. The course overview shows that plan and can generate or regenerate it.
- The course overview lists deterministic recommendations: due cards, the weakest topic, and an unreviewed digest. Each one opens that view.
- Explain weakest topic opens Chat in Explain with a prompt for that topic.
- Make card takes a text selection in a digest, edits the front and back, and appends the card to the deck with the digest, heading, and page. The new card is due.
- Plan markdown and card text stay on the escaped render path. The content security policy is unchanged.

## 3.3.0 — 2026-10-17

Git tag: `v3.3.0` when this release lands. **Product:** Version 4 in progress (review scheduling and weak topics), not `v4.0.0`. Worker, desktop, and Tauri report `3.3.0`, including `arbor-worker --version`.

- Flashcard and quiz progress move to `<course>/study/progress.json` (schema 1). Existing `.arbor/progress/<course>.flashcards.json` and `.quiz.json` files migrate once.
- SM-2-lite: Mastered grows the interval by the stored ease (default 2.5, minimum 1 day). Wrong is due again in 10 minutes. Again stays in the session.
- Flashcards open on Due today, and the full deck is still available.
- The course overview lists the top 5 weak topics from concept and digest-heading wrong rates, and each one opens that heading in Notes.
- Chat answers use the UI font, and the active Ask, Explain, or Quiz button is highlighted ([#75](https://github.com/MrF1ow/Arbor/issues/75)).

## 3.2.0 — 2026-10-17

Git tag: `v3.2.0` when this release lands. **Product:** Version 4 in progress (Chat tab), not `v4.0.0`. Worker, desktop, and Tauri report `3.2.0`, including `arbor-worker --version`.

- Chat tab on each course: Ask, Explain, and Quiz modes with streaming status (retrieving, answering, done).
- Per-course history in `<root>/.arbor/chat/<course>.jsonl` with New chat session boundaries and Clear history.
- Citation chips open the digest in Notes at the cited heading; unsupported answers show a **Not supported by this course** banner.
- Answers render through the escaped markdown path (CSP unchanged).
- **Generate study artifact** is the only write from chat (existing flashcard or quiz jobs).

## 3.1.0 — 2026-10-17

Git tag: `v3.1.0` when this release lands. **Product:** Version 4 in progress (chat worker), not `v4.0.0`. Worker, desktop, and Tauri report `3.1.0`, including `arbor-worker --version`.

- `arbor-worker chat` answers from course digests (semantic search plus FTS), always includes `course.md`, and keeps a 12k character source budget.
- Answers cite `[n]`. The worker maps those to digest path, heading id, page range, and source file. Unsupported questions set `supported` false.
- Modes are ask, explain, and quiz. The command is read-only.
- Digest output drops model preamble before the first heading ([#71](https://github.com/MrF1ow/Arbor/issues/71)).
- Grok still uses the tool denylist, and a reported tool call fails the run ([#72](https://github.com/MrF1ow/Arbor/issues/72)).

## 3.0.0 — 2026-10-17

Git tag: `v3.0.0` is tagged. **Product:** Version 3 shipped. Version 4 is in progress (not started). Worker, desktop, and Tauri report `3.0.0`, including `arbor-worker --version`.

Linux live run recorded in [linux-live-run.md](docs/superpowers/plans/2026-10-17-roadmap-completion/linux-live-run.md). Boxes 1–3 and 5–15 passed. Box 4 is partial: no live digest contained a table or emphasis.

- Grok digests cannot call tools (`--disallowed-tools`).
- Study digests resolve when the model omits the `digests/` prefix, and `..` paths are not followed.
- Grok image prompts go through `--prompt-file` so large page sets stay under Linux `MAX_ARG_STRLEN`.
- Study JSON may have a preamble before the object.
- A signed-out Confirm, Update, or study action logs the provider’s reason and does not start a job.
- Packaged Linux AppImage and deb bundle `arbor-worker` and launch without the repo or `uv`.

## 2.5.0 — 2026-10-17

Git tag: `v2.5.0` when this release lands. **Product:** Version 3 in progress (CLI provider registry). Not `v3.0.0`. Worker, desktop, and Tauri report `2.5.0`, including `arbor-worker --version`.

- Provider registry (`codex`, `claude`, `grok`, `fake`) with shared `CliProvider` interface and `list-providers`.
- Claude Code CLI provider (`claude -p`, JSON `result`; disabled inside a Claude Code session when `CLAUDECODE=1`).
- Grok CLI provider (prompt file / prompt-json, read-only tool policy).
- Settings **Provider** select above **Model**; top-bar badge shows the selected provider label and auth state.
- Per-provider model lists in `.arbor/models.json` (`providers` map).

## 2.4.0 — 2026-10-17

Git tag: `v2.4.0` when this release lands. **Product:** Version 3 in progress (tree mark and tag gate). Not `v3.0.0`. Worker, desktop, and Tauri report `2.4.0`, including `arbor-worker --version`.

- Transparent tree mark in the sidebar, welcome screen, favicon, and window/taskbar icons, with a cream trunk on the dark theme.
- The version gate is a recorded Linux live run in [linux-live-run.md](docs/superpowers/plans/2026-10-17-roadmap-completion/linux-live-run.md). Mac batches are optional and never block a tag.

## 2.3.0 — 2026-10-17

Git tag: `v2.3.0`. **Product:** Version 3 in progress (Mac-batch fixes). Not `v3.0.0`. Worker, desktop, and Tauri report `2.3.0`, including `arbor-worker --version`.

- Concepts validation resolves edge labels and slugs to assigned node ids. Ambiguous labels fail instead of selecting either node. This fixes the Graph blocker from issue [#57](https://github.com/MrF1ow/Arbor/issues/57).
- Citation matching strips Markdown emphasis and punctuation before checking claims and headings, so formatted digest words match sentence-style study text ([#57](https://github.com/MrF1ow/Arbor/issues/57)).
- The default Tauri capability grants `notification:default`, so job-end notifications can pass the plugin permission check. Issue [#57](https://github.com/MrF1ow/Arbor/issues/57).
- Quiz toolbar shows the session score as `N / M correct` from this session's answers. The question index stays as `N of M`.
- Digest markdown renders links and GitHub-flavored tables. A relative `digests/*.md` link opens that digest in the reading pane. The reading pane strips closing `arbor-pages` comments.
- `study`, `digests`, `_arbor_cache`, and dot-prefixed names at the Knowledge root are reserved. Create Class now keeps a clear rejection reason visible in the sidebar instead of relying on a native WebKit validity tooltip.
- An in-place digest patch validates each provider splice with `validate_digest`. Non-portable LaTeX (`\(`, `\[`, `\frac`) is rejected the same way as create and regenerate.
- Add files no longer creates `lecture-2.pdf` when a lecture with that name is already in the class. Same name replaces the existing file so page alignment can run. A file already in the class is left in place. Numbered copies are only for two same-named files in one picker batch.
- Living [implementation checklist](docs/implementation-checklist.md) tracks implemented vs locally tested vs Mac-batch tested. Product versions do not start until the previous version’s Mac batch is recorded. GitHub issues #3, #4, #19, #21, #30, #42, and #20 are mapped into `PROJECT.md` versions with their original acceptance criteria. [Version 3 Notes leftovers](docs/superpowers/plans/2026-09-12-v3-notes-gate.md) (links, tables, reserved dirs, patch validation) are locally tested. The 2026-09-20 Mac batch (issue [#57](https://github.com/MrF1ow/Arbor/issues/57)) found Concepts edge-label rejection, citation false Unverified, silent reserved class names, and a missing quiz session score. It does not close Version 3.
- Desktop file reads stay inside the selected Knowledge root. Digest and study text is escaped before it reaches the webview. The window sets a content security policy. CI runs the Python, Rust, and desktop tests. (#64)

## 2.2.0 — 2026-08-26

Package `2.2.0`. Git tag `v2.2.0` is for the operator after this lands. **Product:** Version 3 in progress (study loop). Not `v3.0.0`. That tag waits for a recorded Mac E2E run.

Waves 1 through 8 plus library UX. Do not backfill tags `v2.3.0` through `v2.8.0`.

Library UX.

- Desktop `tauri dev` finds the worker by walking up to `python/pyproject.toml` instead of using Tauri's `resource_dir` parent. That parent was `src-tauri/target`, so the model picker failed with `Project directory 'target/python' does not exist`. `ARBOR_REPO_DIR` still overrides. If the worker project is missing, the error names that variable.
- Opening the Vite URL in a browser no longer throws `Cannot read properties of undefined (reading 'invoke')`. The welcome pane says to use the Arbor desktop window.
- Add a class from the Library sidebar. Add lecture PDF, PowerPoint, or Word files into the open class from the course header. Arbor copies them into the Knowledge folder so Update can see them.
- Appearance (System, Light, Dark) lives in Settings. The choice is stored with app settings and no longer depends only on the OS color scheme.
- The `_arbor_cache` worker folder is not listed as a class.
- Codex auth looks in `~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin` as well as `PATH`, so a Finder-launched Mac app can see a Homebrew Codex install. A failed check shows the worker error instead of a bare "Check failed".
- Digest index titles come from the lecture H1 (prompt: at most eight words). The dated filename stays on disk and shows as the date line.
- Notes reading pane scrolls on WebKit (Mac). Digest markdown renders bold, italic, numbered lists, asterisk bullets, and nested lists.

Closeout (Wave 8, issue #42).

- Flashcard Again / Wrong / Mastered write `correct` / `wrong`. Flip and Next do not grade.
- Quiz Previous/Next restore a submitted answer. Each question id is scored once per session.
- Source chips scroll to the cited heading.
- Living docs match the study loop. Do not backfill tags `v2.3.0` through `v2.8.0`.

Diagrams (Wave 6).

- `arbor-worker generate --skill diagrams` reads prepare-cache page images for that course’s source hashes, forces `kind: figure` nodes with `fig-` ids, and merges them into `study/concepts.json` with edges to related topics. Empty figure results succeed and leave the graph file untouched. A later concepts refresh keeps figure nodes and those links.
- Graph tab: Generate figures, dashed figure chips in Notes, figure rows in the concept list. Source chips still open Notes.

Citations (Wave 7).

- `arbor-worker generate --skill citations` walks flashcards, quiz, and every cited digest on a concept. Matching claims stay quiet. Invented claims and missing digests emit `citation_failed` and write `study/citations.json` without rewriting the study artifacts.
- Jobs panel Check citations. Unverified badges on cards, quiz review, and concept rows. Clicking a source still opens the cited digest. The inspector logs `skill_*` and `citation_failed` with skill, path, id, and reason instead of a bare event type.

Graph (Wave 5).

- `arbor-worker generate --skill concepts` writes `study/concepts.json` with slug node ids, merges duplicate names by source, and commits `study: {course} concepts`. Concatenated digests over 100k characters split per digest, then merge graphs. Unchanged digest hashes still emit `skill_stale_skipped`.
- Graph tab: empty Generate, concept list with neighbors and source chips to Notes, stale badge and Refresh from digests. Notes shows related concept chips for the open digest.

Quiz (Wave 3).

- `arbor-worker generate --skill quiz` writes `study/quiz.json`, assigns `q_` ids from normalized prompt plus digest, and commits `study: {course} quiz`. Concatenated digests over 100k characters split per digest, then merge and drop duplicate prompts. Unchanged digest hashes still emit `skill_stale_skipped`.
- `.arbor/settings.json` reads `auto_generate.quiz` (default false). Desktop Generate / Refresh run Codex when a model is selected. Progress lives in `.arbor/progress/<course>.quiz.json` and keeps counts for stable ids.
- Quiz tab: empty Generate, one question with four choices, Submit then explanation, next / prev, source chip to Notes, stale badge. After Update, optional auto-generate queues behind flashcards through the existing job mutex.

Memory and semantic search (Wave 4).

- `arbor-worker embed` chunks digests by heading, builds local 256-dimension hashed n-gram vectors, and replaces stale rows in the gitignored `.arbor/vectors.sqlite` store.
- `arbor-worker embed-search` runs brute-force cosine search and returns digest-shaped search hits without a network service.
- The desktop search overlay keeps full-text search as the default and adds a Semantic toggle. An optional "Embed after Update" setting queues embedding through the existing job mutex.

Flashcards (Wave 2).

- `arbor-worker generate --skill flashcards` writes `study/flashcards.json`, assigns `fc_` ids from normalized front plus digest, and commits `study: {course} flashcards`. Concatenated digests over 100k characters split per digest, then merge and drop duplicate fronts. Unchanged digest hashes still emit `skill_stale_skipped`.
- `.arbor/settings.json` reads `auto_generate.flashcards` (default false). Desktop Generate / Refresh run Codex when a model is selected. Progress lives in `.arbor/progress/<course>.flashcards.json` and keeps counts for stable ids.
- Flashcards tab: empty Generate, flip / next / prev / shuffle, source chip to Notes, stale badge. Quiz Generate stays disabled.

Study framework (Wave 1).

- `arbor-worker generate --root --course --skill fixture` writes `study/fixture.json` and `study/manifest.json`, then commits `study: {course} fixture`. Unchanged digests emit `skill_stale_skipped`. Invalid JSON retries twice and leaves a prior artifact untouched.
- `.gitignore` gains `.arbor/progress/` and `.arbor/vectors.sqlite` on generate.
- Desktop `start_study_job` reuses the job mutex with copy "A job is already running for {root}". Quiz generation remains disabled.

## 2.1.0 — 2026-08-22

Git tag: `v2.1.0`. **Product:** Version 3 in progress (shell only). Not `v3.0.0` — that tag is reserved for full Version 3 completion.

Version 2 ingest, automation, and search are unchanged. This release replaces the single-column debug UI with a student-facing desktop shell.

- Desktop shell: sage and cream palette, 1100×760 window (min 900×640), sidebar with course library, Jobs and Settings at the bottom.
- Course workspace: Notes / Flashcards / Quiz mode tabs. Notes mode browses `course.md` and digest previews in-app (serif reading pane, page-marker chips).
- Flashcards and Quiz tabs show a Coming soon empty state until later `v2.x` releases.
- Bottom inspector (collapsed by default): Update knowledge, review table, and job log. No always-visible terminal on the home screen.
- In-app Settings: watch folder, auto-run, delete-after-digest, model picker, and reindex. Writes `.arbor/settings.json`.
- Search overlay in the course header. Hits open Notes and navigate to the matching digest.
- New Tauri commands: `list_courses`, `list_digests`, `read_markdown`, `save_knowledge_settings`.
- Dark mode follows `prefers-color-scheme` with the same hierarchy as light.
- Reference mockup: `docs/mockups/v3-shell.html`.

Not in this release: flashcard or quiz generation, embeddings, semantic search, chat. **Not a Version 3 completion release.**

## 2.0.0 — 2026-08-22

Git tag: `v2.0.0`. Product milestone: [PROJECT.md](PROJECT.md) Version 2.

Version 1 loop is unchanged: pick a Knowledge folder, review page ranges, Codex writes digests, git commits. This release adds automation and findability on that same screen.

- Job spine. SQLite at `<Knowledge>/.arbor/arbor.db`, one update at a time, persisted JSONL events, Recent runs in the desktop UI. (#25)
- SQLite FTS5 search over digests. `arbor-worker reindex --root` rebuilds the index. Search box in the app. (#26)
- Folder watch via `notify`. Default is watch then review, not silent ingest. Missing `.arbor/settings.json` still leaves `watch_enabled` on. (#26, #32)
- Optional `"auto_update": true` in `.arbor/settings.json` starts the job without Confirm. Those jobs record `trigger_kind` `watch`.
- Desktop notification when a job succeeds, fails, or is cancelled.
- Word (`.docx`) prepare path. Optional Tesseract OCR for low-text PDF pages.
- macOS `.dmg` from GitHub Actions. `arbor-worker` is bundled. Codex CLI stays a separate install. Signing and notarization stay off.

Mac validation from source: full PDF ingest and commit, version-2 fingerprints, digest markers, course rollup, job history, search, reindex, and folder-watch review after shortening a PDF.

Not in this release: notarized Mac builds, in-app chat, flashcards, a visual redesign. The UI is still the Version 1 single-column shell.

## 1.0.0 — 2026-08-19

Git tag: [`v1.0.0`](https://github.com/MrF1ow/Arbor/releases/tag/v1.0.0). Merge: [PR #24](https://github.com/MrF1ow/Arbor/pull/24).

- First downloadable macOS `.dmg`. GitHub Actions `macos-dmg` bundles `arbor-worker` as a Tauri sidecar via PyInstaller. Codex CLI stays a separate install. Signing and notarization stay off.
- Treat leftover pages as pending after a partial ingest. Empty fingerprint slots keep the source in the plan with those ranges suggested.
- A failed two-digest course rollup still saves `arbor-course.json`, digest files, and a link-only `course.md`, then commits so the next Update does not duplicate work.
- Course rollup prompts include the same source and formatting rules as lecture digests.
- Confirm re-checks Codex auth. `start_update` also runs `check-auth` before spawning the worker.

Not in this release: notarized Mac builds, in-app chat (#20), PROJECT.md Version 2.

## 0.2.0 — 2026-08-19

Git tag: [`v0.2.0`](https://github.com/MrF1ow/Arbor/releases/tag/v0.2.0). Merge: [PR #22](https://github.com/MrF1ow/Arbor/pull/22).

- Confirm page ranges in the review panel (`151-300`, `40-55, 120-122`). Plan JSON is `{ selections: [{ path, ranges }] }`.
- Persist per-page fingerprints in `arbor-course.json` (`version` 2 `sources`). Suggest dirty ranges on the next Update.
- Wrap new digests in `<!-- arbor-pages:X-Y -->`. Overlapping coverage patches that block in place instead of adding a second digest file.
- One digest writes a short local `course.md` index. Two or more still roll up with Codex.
- Force PPTX image fallback when the confirmed range is not the whole deck.
- Resolve Codex CLI on a Finder-like PATH and time out hung `login status`. Single-flight desktop auth refresh.
- Reject LaTeX tokens and require portable Markdown in lecture digests.
- `FakeProvider` returns markdown unchanged. Tests that need markers wrap in the test helper.

Not in this release: notarized Mac builds, in-app chat (#20), PROJECT.md Version 2.

## 0.1.0

First public worker and desktop loop: course folders, dated digests, chunked large PDFs, Codex CLI only.

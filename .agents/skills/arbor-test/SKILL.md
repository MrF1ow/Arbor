---
name: arbor-test
description: How to run, test and verify Arbor safely - start the desktop app and the Python worker, the checks CI runs, every surface a change shows up on, and what never to touch (the user's screen, real provider accounts, their settings). Use before running, testing or verifying Arbor, or a change to it.
watches:
  - desktop/package.json#scripts
  - desktop/vite.config.ts
  - desktop/src-tauri/tauri.conf.json
  - desktop/src-tauri/Cargo.toml
  - python/pyproject.toml
  - .github/workflows/test.yml
  - docs/superpowers/plans/2026-10-17-roadmap-completion/linux-live-run.md
updated: "ce19c4db965af1da07349fa5971b9670609518d9"
---

# Run, test and verify Arbor

Three parts: `python/` (the `arbor-worker` CLI, uv), `desktop/` (React + Vite frontend, npm), `desktop/src-tauri/` (the Tauri v2 Rust shell that spawns the worker).

## Run it
- Install: `cd desktop && npm ci` and `cd python && uv sync`. A fresh worktree has neither, so every desktop check fails until `npm ci` runs.
- Frontend only, no Tauri, mocked IPC: `cd desktop && npx vite --mode mock --port <free port> --strictPort`. Use a port other than 1420/1421 so you don't collide with another checkout.
- Full app: `cd desktop && npm run tauri dev`. It uses fixed ports 1420 and 1421 (`strictPort`), so only one checkout can run it at a time. Run it **only on a leased private display** (see Ways to hurt yourself).
- Worker: `cd python && uv run arbor-worker --help`. All commands print JSON/JSONL. Dev builds find `python/` by walking up from the crate; `ARBOR_REPO_DIR`, `ARBOR_PYTHON_DIR` and `ARBOR_WORKER_CMD` override that.
- Seed data: none in the repo. Make a scratch Knowledge root under your scratchpad or `/tmp`: `git init`, a commit, then `<Course>/<file>.pdf`.

## Test it
- Fast, changed files only: none. Run the full checks.
- Full suite (about 4 min in all), the same as `.github/workflows/test.yml`:
  - `cd desktop && timeout 600 npm test` (style check, node tests, vitest; ~50s)
  - `cd desktop && timeout 600 npm run lint` (eslint `--max-warnings 0`; ~10s)
  - `cd desktop && timeout 900 npm run build` (tsc + vite + bundle check; ~20s)
  - `cd python && timeout 900 uv run pytest` (~60s)
  - `mkdir -p desktop/dist && timeout 1800 cargo test --manifest-path desktop/src-tauri/Cargo.toml` (~1 min warm; first build much longer)
- Desktop tests are mostly source greps and miss type and runtime errors. Build and lint are not optional.
- Known local flake: `src/components/app/search-palette.test.tsx` ("anchors the palette below the header…") times out under load on this machine (`Unable to find role="dialog"`), and CI is green on the same commit. Rerun `npx vitest run src/components/app/search-palette.test.tsx` before blaming your change. Same for `src/routes/settings.test.tsx > settings > forces check_auth after a provider change`: it fails under load (full `npm test` while pytest runs) and passes alone.
- CI: `test.yml` (python, desktop, rust jobs) on every PR and on main; `macos-dmg.yml` builds the DMG on main; `release-macos.yml` publishes a Release on a `v*` tag.

## Verify on the real thing
- UI, mocked: start mock mode (above) and load it in a headless browser; screenshot from there, never from the real outputs.
- UI, real app: Tauri on a private Xvfb display. Follow `docs/superpowers/plans/2026-10-17-roadmap-completion/linux-live-run.md`: `dbus-run-session`, `GDK_BACKEND=x11`, `WAYLAND_DISPLAY` and `HYPRLAND_INSTANCE_SIGNATURE` unset, scratch `HOME`/XDG/`GIT_CONFIG_GLOBAL`, screenshots with `magick import -display :<n>`, input with `DISPLAY=:<n> xdotool …` (the installed xdotool rejects `--display`; type paths with `--delay 150`). Get the display number from `flow-run lease <run> display` (a flow lead does this and puts it in your brief; `flow-run` is not on `PATH`). A fresh worktree has no `desktop/src-tauri/target`, so the first `tauri dev` is a full Rust build of several minutes; under a scratch `HOME`, set `CARGO_HOME` to the real `~/.cargo` or cargo fetches every crate again. To read the app's hash URL (class pages carry `?root=<library>`), open Inspect Element from the webview's context menu and log `location.hash` in its console. Alt+Left is unbound in WebKitGTK and the app has no Back button: use the context menu's Back and Forward. Close the docked inspector before typing into the app: it keeps keyboard focus. The exam date is Arbor's own calendar popover (no native date input): picking a day saves at once, Clear removes the date, Escape closes without saving. There is no window manager on Xvfb, so `xdotool windowactivate` fails: click into the window instead.
- Skip the folder picker and provider setup: before launch, write `$XDG_CONFIG_HOME/com.arbor.app/settings.json` under the scratch XDG dir with `knowledge_roots` and `active_root` set to the scratch Knowledge root, `provider_id` `claude` and a `model_id`. Per-user state (reading progress, chat threads) lives in `<root>/.arbor/users/<git user email dirname>/`, so to see a copied library's progress the scratch `GIT_CONFIG_GLOBAL` must carry the library owner's `user.email`. To test chat on old data, seed `<root>/.arbor/users/<git user dirname>/chat/<Course>/index.json` and its `<thread id>.jsonl` (shapes in `desktop/src-tauri/src/chat_threads.rs`).
- Packaged build (Linux): `bash scripts/bundle-worker.sh` first, then `cd desktop && NO_STRIP=1 npx tauri build --bundles deb,appimage --config src-tauri/tauri.bundle.json`. Plain `npm run tauri build` bundles no worker. As of v0.6.0 the AppImage step fails in linuxdeploy on the PyInstaller onedir, and the deb puts the worker in `usr/lib/Arbor/arbor-worker/`, a path the app does not search. `dpkg-deb` is not installed here: extract with `bsdtar -xf <deb>` and `bsdtar -xf data.tar.*`.
- CLI/worker: `uv run arbor-worker update --root <scratch root> --provider fake --model m` with `ARBOR_FAKE_MD` set to a digest carrying page markers (copy `_marked_fake_md` from `python/tests/test_cli.py`); without markers the source fails at `generate`. Read the JSONL events and `git -C <root> log`. Under a scratch `HOME`, `uv run` starts with an empty uv cache and Python dir: set `UV_CACHE_DIR=~/.cache/uv UV_PYTHON_INSTALL_DIR=~/.local/share/uv/python` (the real paths) and use `uv run --no-sync`. Live variant: `env -u CLAUDECODE HOME=<scratch HOME> UV_CACHE_DIR=… UV_PYTHON_INSTALL_DIR=… uv run --no-sync arbor-worker update --root <scratch root> --provider claude --model claude-haiku-5-5`, with the scratch root a `git init` repo with an init commit, a `.gitignore` containing `_arbor_cache/`, and `<Course>/<file>.pdf`. Success shows `committed` and a `digest: <Course>` commit.
- Live provider runs: the Claude Code provider (the `claude` CLI, already signed in on the user's Claude plan). Under a scratch `HOME`, copy only `~/.claude/.credentials.json` into `<scratch HOME>/.claude/` (mode 600). Before starting the app, run the pre-check under exactly the env the app gets: the same scratch `HOME` and `PATH`, `MISE_TRUSTED_CONFIG_PATHS` set when `claude` is the mise wrapper (`~/.local/share/mise/command-wrappers/bin/claude` may not resolve under a scratch `HOME`: either put a symlink to `mise which claude` first on `PATH`, or set `MISE_TRUSTED_CONFIG_PATHS`), and `CLAUDECODE` unset (this pre-check runs the CLI directly, and the worker CLI refuses the Claude provider when `CLAUDECODE=1`; the desktop app scrubs `CLAUDECODE` and the other Claude Code session vars from every worker it spawns, so launching it from a Claude Code terminal is fine). Send it as a stream-json user line with the flags the page-image path uses (it checks the flags, not an image payload):
  ```bash
  echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"say ok"}]}}' \
    | env -u CLAUDECODE HOME=<scratch HOME> PATH=<app PATH> MISE_TRUSTED_CONFIG_PATHS=<repo root> \
      claude -p --model claude-sonnet-5-5 --input-format stream-json --output-format stream-json --verbose \
      --tools "" --no-session-persistence --setting-sources "" --strict-mcp-config
  ```
  The last line must be a `result` event with `is_error: false`. Delete the credentials copy at cleanup.

## Ways to hurt yourself
- **The user's screen is live.** They play games on it while agents work; one agent closed their fullscreen game by focusing an Arbor window. Never `hyprctl dispatch`, never send synthetic input to, focus, or `grim` the real outputs. No leased private display: stop and ask.
- **Provider accounts:** live runs use the Claude Code provider; never write the real `~/.claude` (use the scratch copy of the credentials). Codex has no subscription here, so test it with fakes only. Don't log the real `claude` CLI out; fake a signed-out state with a scratch `HOME` that has no `.credentials.json` (`claude auth status` then reports `loggedIn: false` and a run returns "Not logged in · Please run /login").
- **Real settings:** `~/.config/com.arbor.app/settings.json` and the OS keyring hold the user's data. Use a scratch `HOME`/XDG so a run can't write them, and check the file is byte-identical afterwards.
- **`~/.ssh` and system sshd:** remote-worker tests use a private sshd on localhost with a throwaway key; leave `~/.ssh` unchanged.
- **Teardown that kills your own shell:** `pkill -f`/`pgrep -f` patterns like `target/debug/desktop` match your own command line. Use `pgrep -x desktop` / `pgrep -x Xvfb` under `timeout 20`, and never kill a process group your shell is in.
- **Fixed ports 1420/1421:** another checkout's `tauri dev` may hold them.
- **Slow suites:** run everything under `timeout`, and look for orphaned `node --test` processes afterwards.
- **Marketplace pins:** a PR that moves a pin in `marketplace/index.json` must merge with a merge commit, or the pinned commit becomes unreachable.

## Clean up
- Stop the app, Vite and Xvfb by the PID you started (or `pgrep -x`), never by pattern.
- Delete scratch Knowledge roots, scratch `HOME`/XDG dirs and `desktop/dist` if you made it only for `cargo test`.

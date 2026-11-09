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
updated: "4d8982ba9f0ecc4754a4367142e64cc063b3afb1"
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
- Known local flake: `src/components/app/search-palette.test.tsx` ("anchors the palette below the header…") times out under load on this machine (`Unable to find role="dialog"`), and CI is green on the same commit. Rerun `npx vitest run src/components/app/search-palette.test.tsx` before blaming your change.
- CI: `test.yml` (python, desktop, rust jobs) on every PR and on main; `macos-dmg.yml` builds the DMG on main; `release-macos.yml` publishes a Release on a `v*` tag.

## Verify on the real thing
- UI, mocked: start mock mode (above) and load it in a headless browser; screenshot from there, never from the real outputs.
- UI, real app: Tauri on a private Xvfb display. Follow `docs/superpowers/plans/2026-10-17-roadmap-completion/linux-live-run.md`: `dbus-run-session`, `GDK_BACKEND=x11`, `WAYLAND_DISPLAY` and `HYPRLAND_INSTANCE_SIGNATURE` unset, scratch `HOME`/XDG/`GIT_CONFIG_GLOBAL`, screenshots with `magick import -display :<n>`, input with `xdotool --display :<n>` (type paths with `--delay 150`). Get the display number from `flow-run lease <run> display`.
- CLI/worker: `uv run arbor-worker update --root <scratch root> --provider fake --model m` with `ARBOR_FAKE_MD` set to a digest carrying page markers (copy `_marked_fake_md` from `python/tests/test_cli.py`); without markers the source fails at `generate`. Read the JSONL events and `git -C <root> log`.
- Live provider runs: Grok CLI (`grok-4.7`, `~/.grok/bin/grok`, already signed in) only.

## Ways to hurt yourself
- **The user's screen is live.** They play games on it while agents work; one agent closed their fullscreen game by focusing an Arbor window. Never `hyprctl dispatch`, never send synthetic input to, focus, or `grim` the real outputs. No leased private display: stop and ask.
- **Never make Arbor spawn `claude`.** Don't pick the Claude Code provider in a live run. Codex has no subscription here, so test it with fakes only. Don't log out the real Grok CLI; fake a signed-out state in a private mount namespace (see the live-run doc).
- **Real settings:** `~/.config/com.arbor.app/settings.json` and the OS keyring hold the user's data. Use a scratch `HOME`/XDG so a run can't write them, and check the file is byte-identical afterwards.
- **`~/.ssh` and system sshd:** remote-worker tests use a private sshd on localhost with a throwaway key; leave `~/.ssh` unchanged.
- **Teardown that kills your own shell:** `pkill -f`/`pgrep -f` patterns like `target/debug/desktop` match your own command line. Use `pgrep -x desktop` / `pgrep -x Xvfb` under `timeout 20`, and never kill a process group your shell is in.
- **Fixed ports 1420/1421:** another checkout's `tauri dev` may hold them.
- **Slow suites:** run everything under `timeout`, and look for orphaned `node --test` processes afterwards.
- **Marketplace pins:** a PR that moves a pin in `marketplace/index.json` must merge with a merge commit, or the pinned commit becomes unreachable.

## Clean up
- Stop the app, Vite and Xvfb by the PID you started (or `pgrep -x`), never by pattern.
- Delete scratch Knowledge roots, scratch `HOME`/XDG dirs and `desktop/dist` if you made it only for `cargo test`.

# Arbor Desktop

Tauri v2 shell for Arbor (package **2.1.0**). Drives the `arbor-worker` CLI (see `../python`).

The UI is the Version 3 shell (first delivery in **v2.1.0**; full Version 3 completes at **v3.0.0**). Sidebar library, course workspace with Notes / Flashcards / Quiz tabs, in-app digest preview, and a collapsed bottom inspector for Update and job logs.

Design spec: [`docs/superpowers/specs/2026-08-22-v3-desktop-shell-design.md`](../docs/superpowers/specs/2026-08-22-v3-desktop-shell-design.md). Reference mockup: [`docs/mockups/v3-shell.html`](../docs/mockups/v3-shell.html).

## Prerequisites

- Rust + cargo, Node 20+, npm
- `uv` on PATH and the worker installed: `cd ../python && uv sync`
- Codex CLI installed and authenticated: <https://developers.openai.com/codex/cli>
- Linux only: webkit2gtk + libsoup dev packages
- Optional (PPTX image fallback): LibreOffice (`soffice`)

## Run in dev

```bash
# From repo root, tell the shell where the worker lives:
export ARBOR_REPO_DIR="$(pwd)"          # repo root containing python/
cd desktop && npm install && npm run tauri dev
```

`ARBOR_WORKER_CMD` (space-separated) fully overrides how the worker is launched when no
sidecar binary sits next to the app executable. `ARBOR_PYTHON_DIR` overrides just the uv
project dir. A packaged Mac build launches `arbor-worker` from the Tauri sidecar instead of `uv`.

The DMG is produced by `.github/workflows/macos-dmg.yml` (artifact on `main`) and
`.github/workflows/release-macos.yml` (GitHub Release on a `v*` tag).
`scripts/bundle-worker.sh` builds the sidecar. `src-tauri/tauri.bundle.json` is a merge
config used only for that build so `tauri dev` still uses `uv`.

## Linux graphics (Wayland / NVIDIA)

If the app prints `Gdk-Message: Error 71 (Protocol error) dispatching to Wayland
display` and exits, Arbor applies NVIDIA-specific workarounds automatically at
startup (see `src-tauri/src/linux_graphics.rs`).

If it still fails, try one of these **before** `npm run tauri dev`:

```bash
# Broader WebKit fix (slower rendering, works on many Wayland setups)
export WEBKIT_DISABLE_DMABUF_RENDERER=1

# Or force X11 via XWayland (Hyprland / Omarchy)
export GDK_BACKEND=x11
```

See [Tauri Linux graphics debugging](https://v2.tauri.app/develop/debug/linux-graphics/).

## Manual test checklist (real Codex)

1. **Welcome:** launch with no saved folder → welcome screen; Choose Knowledge folder works.
2. **Auth blocks work:** with Codex logged out, sidebar badge is red and **Update knowledge** stays disabled.
3. **Auth passes:** `codex login`, refocus the window → badge turns green, button enables.
4. **Library:** course folders appear in the sidebar; selecting one opens Notes with digest index.
5. **Preview:** click a digest → markdown renders in the reading pane; page-marker chip shows when present.
6. **Review panel:** put a PDF at `Biology/mega.pdf`, click **Update knowledge** in the inspector → review table appears.
7. **Full ingest:** Confirm with ranges empty → digest, `course.md`, `arbor-course.json`, and `digest:` commit.
8. **Idempotency:** Update again with no changes → "Nothing to process" in the inspector log.
9. **Search:** ⌕ in the course header → hit opens Notes on the matching digest.
10. **Folder watch:** drop a new PDF, wait ~3 seconds → review panel in the inspector.
11. **Jobs place:** sidebar **Jobs** lists recent runs with expandable log.
12. **Settings place:** toggles write `.arbor/settings.json`; reindex succeeds.
13. **Modes:** Flashcards and Quiz tabs show Coming soon.
14. **Cancel:** Cancel during a run stops after the current range; log shows "Cancelled".

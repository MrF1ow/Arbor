# Arbor Desktop

Minimal Tauri v2 shell for Arbor (package **1.0.0**). Drives the `arbor-worker` CLI (see `../python`).

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

The DMG is produced by `.github/workflows/macos-dmg.yml`. `scripts/bundle-worker.sh` builds
the sidecar. `src-tauri/tauri.bundle.json` is a merge config used only for that build so
`tauri dev` still uses `uv`.

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

1. **Auth blocks work:** with Codex logged out, the badge is red, shows the reason and a
   "Set up Codex" link, and **Update Knowledge** stays disabled.
2. **Auth passes:** `codex login`, refocus the window → badge turns green, button enables.
3. **Confirm re-checks auth:** open the review panel, log out of Codex, Confirm stays blocked.
4. **Pick folder:** choose an empty folder → log shows "Initialized git repository".
5. **Review panel:** put a PDF at `Biology/mega.pdf`, click Update → the panel lists the file
   with its page count and an empty Ranges box.
6. **Full ingest:** Confirm with the box empty → `Biology/digests/<date>.md`, a short
   `Biology/course.md` index, and `Biology/arbor-course.json` appear, and a `digest:` commit is made.
7. **Idempotency:** click Update again with no changes → "Nothing to process".
8. **Growth:** append pages to `mega.pdf`, click Update → the panel prefills the new tail
   range; Confirm writes a second dated digest and rewrites `course.md` with a Codex rollup.
9. **Overlap patch:** change pages inside an already-digested window, confirm that overlap
   → still one digest file, markers kept, inner notes updated. Not a second lecture file.
10. **Truncation:** shrink the PDF and leave Ranges blank when suggestions are empty → no work.
11. **Cancel:** with two changed sources, click Cancel after the first → only completed digests are
   committed; log shows "Cancelled".
12. **Open folder:** click Open → the Knowledge folder opens in the file manager.

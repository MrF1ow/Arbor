# Arbor Desktop

Minimal Tauri v2 shell for Arbor. Drives the `arbor-worker` CLI (see `../python`).

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

`ARBOR_WORKER_CMD` (space-separated) fully overrides how the worker is launched;
`ARBOR_PYTHON_DIR` overrides just the uv project dir.

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
3. **Pick folder:** choose an empty folder → log shows "Initialized git repository".
4. **Review panel:** put a PDF at `Biology/mega.pdf`, click Update → the panel lists the file
   with its page count and an empty "Start from" box.
5. **Full ingest:** Confirm with the box empty → `Biology/digests/<date>.md`, `Biology/course.md`,
   and `Biology/arbor-course.json` appear, and a `digest:` commit is made.
6. **Idempotency:** click Update again with no changes → "Nothing to process".
7. **Growth:** append pages to `mega.pdf`, click Update → the panel prefills "Start from" with the
   first new page; Confirm writes a second dated digest and rewrites `course.md`.
8. **Cancel:** with two changed sources, click Cancel after the first → only completed digests are
   committed; log shows "Cancelled".
9. **Open folder:** click Open → the Knowledge folder opens in the file manager.

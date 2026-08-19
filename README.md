# Arbor

Local-first desktop app that turns course PDFs and PowerPoints into structured study digests using the [Codex CLI](https://developers.openai.com/codex/cli). Your Knowledge library is a normal git repo on disk. Sources and generated notes stay together in history.

**Current release:** [1.0.0](CHANGELOG.md) (git tag `v1.0.0`). Worker, desktop, and Tauri all report this number (`arbor-worker --version`).

**Product milestone:** still [PROJECT.md](PROJECT.md) Version 1. One window, one **Update Knowledge** button, Codex CLI only (no API keys). 1.0.0 is the first downloadable Mac app on that loop. It is not Version 2 (watchers, search, extra providers).

For vision and later milestones, see [`PROJECT.md`](PROJECT.md). The original V1 design (`lecture.md` per lecture) is historical: [`docs/superpowers/specs/2026-08-02-arbor-v1-design.md`](docs/superpowers/specs/2026-08-02-arbor-v1-design.md). Living layout is course folders, dated `digests/`, and `arbor-course.json`.

## Download (macOS)

Download the `.dmg` from the [latest GitHub Release](https://github.com/MrF1ow/Arbor/releases/latest). The `macos-dmg` workflow also uploads an `arbor-macos-dmg` artifact. That runner is usually Apple Silicon.

Install the [Codex CLI](https://developers.openai.com/codex/cli) yourself and log in before the first Update. The app includes `arbor-worker`. It does not include Codex. Signing and notarization stay off until Apple secrets are added, so macOS Gatekeeper may require Open Anyway.

Clone and run from source for Linux, or to develop.

---

## How it works

```
Arbor desktop (Tauri)  →  arbor-worker (Python)  →  Codex CLI
```

1. Pick a **Knowledge** folder (git repo).
2. Create one folder per course (`Biology/`, `Chemistry/`) and put sources anywhere inside.
3. Click **Update Knowledge** and review the detected files.
4. Edit page ranges per file (for example `151-300` or `40-55, 120-122`), then Confirm. A blank box on a new file means the whole file. A blank box on a truncated file (`changed` with no suggested ranges) means skip.
5. Each confirmed range creates or patches `digests/<date>.md` (with page markers). One digest writes a short local `course.md` index; two or more are rolled up with Codex. The run is committed.

Reprocessing is driven by `arbor-course.json`. A source is picked up when it is new, its
whole-file hash changed, or some pages still have empty fingerprints after a partial ingest.
Per-page fingerprints in the manifest suggest leftover or dirty ranges for mega-decks.
Overlapping coverage is patched in place instead of stacking duplicate digests.
Editing digests by hand never triggers reprocessing.

---

## Prerequisites

### All platforms

| Requirement | Notes |
|-------------|--------|
| **macOS or Linux** | V1 targets these; Windows is untested |
| **Git** | Knowledge library must be a git repo |
| **Codex CLI** | Installed and logged in — [Codex CLI docs](https://developers.openai.com/codex/cli) |
| **Python ≥ 3.11** | Worker runtime |
| **[uv](https://docs.astral.sh/uv/)** | Installs and runs the Python worker |
| **Rust + cargo** | Tauri desktop shell ([rustup](https://rustup.rs/)) |
| **Node.js 20+** and **npm** | Desktop frontend build |

### Linux (desktop build)

Tauri needs WebKitGTK and related dev packages. Examples:

**Arch Linux**

```bash
sudo pacman -S base-devel webkit2gtk-4.1 libsoup3
```

**Debian / Ubuntu**

```bash
sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev build-essential
```

**Fedora**

```bash
sudo dnf install webkit2gtk4.1-devel libsoup3-devel gcc
```

### Optional

| Tool | When you need it |
|------|------------------|
| **LibreOffice** (`soffice`) | PPTX image fallback: thin text, or a confirmed range that is not the whole deck |
| **X11 / XWayland** | Last resort if WebKit crashes on Wayland + NVIDIA (see [Linux graphics](#linux-graphics-wayland--nvidia) below) |

---

## Quick start

### 1. Clone the repo

```bash
git clone git@github.com:MrF1ow/Arbor.git
cd Arbor
```

### 2. Install Codex CLI and authenticate

Follow the official guide: <https://developers.openai.com/codex/cli>

Verify login:

```bash
codex login   # if not already authenticated
codex exec --help
```

### 3. Install the Python worker

```bash
cd python
uv sync
uv run arbor-worker check-auth
```

Expected: `{"authenticated": true, ...}` on stdout. If not, fix Codex auth before using the app.

### 4. Install and run the desktop app

From the **repo root**:

```bash
export ARBOR_REPO_DIR="$(pwd)"   # tells the shell where python/ lives

cd desktop
npm install
npm run tauri dev
```

The app opens with folder picker, model dropdown, Codex auth badge, **Update Knowledge**, progress log, and **Open folder**.

### 5. Create a Knowledge library

In the app, choose an empty folder (or an existing git repo). Arbor initializes git if needed.

Layout (you create course folders):

```text
Knowledge/                          # git repo root
  Biology/
    mega.pdf              # sources live anywhere under the course
    readings/chapter.pdf
    digests/
      2026-08-12.md       # one digest per processed window
    course.md             # local index if one digest; LLM rollup if two or more
    arbor-course.json     # processed-state manifest + per-page fingerprints (committed)
  _arbor_cache/           # worker cache (auto-created; gitignored)
  .arbor/
    settings.json         # delete_sources_after_digest, models
```

**Format guidance (V1):**

- **PDF** — best for annotated lectures (ink, handwriting).
- **PPTX** — best for clean slide decks with real text on slides.

---

## Using the app

1. **Codex auth** — Red badge means Update is disabled. Run `codex login`, then refocus the app.
2. **Pick folder** — Select your Knowledge root.
3. **Choose model** — Dropdown lists models from `.arbor/models.json` (optional) or built-in defaults.
4. **Update Knowledge** — review detected files, edit page ranges per source
   (`151-300`, `40-55, 120-122`), then Confirm. Clean appends pre-fill the new tail.
   Ambiguous alignment shows a note; set ranges yourself. Blank on a new file is
   the whole file. Blank on a truncated file does no work.
5. **Cancel** — Stops after the current range or digest action finishes. Completed work is kept.
6. **Open folder** — Opens the Knowledge root in your file manager.

---

## Worker CLI (without the desktop)

From `python/`:

```bash
uv run arbor-worker --version
uv run arbor-worker check-auth
uv run arbor-worker list-models --root /path/to/Knowledge
uv run arbor-worker plan-update --root /path/to/Knowledge
uv run arbor-worker update --root /path/to/Knowledge --model gpt-5.6-sol
uv run arbor-worker update --root /path/to/Knowledge --model gpt-5.6-sol --plan plan.json
```

`update` prints JSONL events to stdout. Exit codes: `0` success, `1` some sources failed, `3` Codex not authenticated.

Event schema and manual live-check steps: [`python/README.md`](python/README.md).

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `ARBOR_REPO_DIR` | Repo root containing `python/` (desktop uses this to locate the worker) |
| `ARBOR_PYTHON_DIR` | Override path to the uv project (default: `$ARBOR_REPO_DIR/python`) |
| `ARBOR_WORKER_CMD` | Full override of worker launch command (space-separated tokens) |
| `WEBKIT_DISABLE_DMABUF_RENDERER=1` | WebKit fallback on problematic Wayland setups |
| `GDK_BACKEND=x11` | Force X11 via XWayland on Hyprland / Omarchy |

---

## Linux graphics (Wayland / NVIDIA)

If the app crashes with:

```text
Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display
```

Arbor applies NVIDIA-specific workarounds at startup automatically (`desktop/src-tauri/src/linux_graphics.rs`).

If it still fails, try **before** `npm run tauri dev`:

```bash
export WEBKIT_DISABLE_DMABUF_RENDERER=1
# or
export GDK_BACKEND=x11
```

More context: [Tauri Linux graphics debugging](https://v2.tauri.app/develop/debug/linux-graphics/) and [`desktop/README.md`](desktop/README.md).

---

## Development

### Run tests (worker)

```bash
cd python
uv run pytest -q
```

### Build desktop (no installer bundle)

```bash
cd desktop
npm run build
cd src-tauri && cargo build
```

### Project layout

```
Arbor/
├── README.md           # this file
├── CHANGELOG.md        # package releases (1.0.0, …)
├── PROJECT.md          # vision and Version 1–5 roadmap
├── scripts/            # sidecar bundle helper for the macOS DMG
├── python/             # arbor-worker CLI and pipeline
├── desktop/            # Tauri v2 shell + UI
└── docs/               # design specs and historical implementation plans
```

Component READMEs:

- [`python/README.md`](python/README.md) — worker commands and event schema
- [`desktop/README.md`](desktop/README.md) — dev run, manual test checklist

---

## Customizing models

Create `.arbor/models.json` in your Knowledge root:

```json
{
  "models": [
    { "id": "gpt-5.6-sol", "label": "Sol 5.6" },
    { "id": "gpt-5.6-terra", "label": "Terra 5.6" }
  ]
}
```

Model IDs must match what your Codex CLI accepts.

`.arbor/settings.json` holds worker options:

```json
{ "delete_sources_after_digest": false }
```

Set it to `true` to delete each source file after it is successfully digested.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| Update button disabled | `codex login`, then `uv run arbor-worker check-auth` |
| Nothing to process | Only new, changed, or leftover-page sources trigger work |
| Wrong page window | Check `suggested_ranges` from `plan-update`. Blank is whole-file only for new sources, not truncation. |
| PPTX prepare failed | Export slides as PDF, or install LibreOffice for image fallback |
| Desktop can't find worker | Packaged app uses the bundled sidecar. From a clone, set `ARBOR_REPO_DIR` to the Arbor repo root |
| Wayland / NVIDIA crash | See [Linux graphics](#linux-graphics-wayland--nvidia) |

---

## License

Not specified yet — private repository.

# Arbor

Local-first desktop app that turns lecture PDFs and PowerPoints into structured study digests using the [Codex CLI](https://developers.openai.com/codex/cli). Your Knowledge library is a normal git repo on disk — sources and generated notes stay together in history.

**V1 scope:** one window, one button (**Update Knowledge**), Codex CLI only (no API keys).

For vision and long-term goals, see [`PROJECT.md`](PROJECT.md). For V1 design details, see [`docs/superpowers/specs/2026-08-02-arbor-v1-design.md`](docs/superpowers/specs/2026-08-02-arbor-v1-design.md).

---

## How it works

```
Arbor desktop (Tauri)  →  arbor-worker (Python)  →  Codex CLI
```

1. Pick a **Knowledge** folder (git repo).
2. Add lecture sources under course/lecture folders you create.
3. Click **Update Knowledge**.
4. The worker discovers new or changed `.pdf` / `.pptx` files, prepares them, calls Codex, and writes `lecture.md` + `metadata.json` beside each source.
5. Successful runs are batch-committed with messages like `digest: Biology/Lecture 01`.

Edits to digest files alone do **not** trigger reprocessing — only dirty source files do.

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
| **LibreOffice** (`soffice`) | PPTX with very little extractable text — worker falls back to rendering slides via LibreOffice → PDF → images |
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

Layout (you create course and lecture folders):

```
Knowledge/                          # git repo root
  Biology/
    Lecture 01/
      source.pdf          # annotated / ink-heavy PDF
      lecture.md          # generated digest
      metadata.json       # model, timestamps, prepare path, etc.
    Lecture 02/
      slides.pptx         # clean slide deck
      lecture.md
      metadata.json
  _arbor_cache/           # worker cache (auto-created; safe to gitignore)
```

**Format guidance (V1):**

- **PDF** — best for annotated lectures (ink, handwriting).
- **PPTX** — best for clean slide decks with real text on slides.

---

## Using the app

1. **Codex auth** — Red badge means Update is disabled. Run `codex login`, then refocus the app.
2. **Pick folder** — Select your Knowledge root.
3. **Choose model** — Dropdown lists models from `.arbor/models.json` (optional) or built-in defaults.
4. **Update Knowledge** — Streams per-lecture stages: discover → prepare → generate → write.
5. **Cancel** — Stops after the current lecture finishes its stage boundary.
6. **Open folder** — Opens the Knowledge root in your file manager.

---

## Worker CLI (without the desktop)

From `python/`:

```bash
uv run arbor-worker check-auth
uv run arbor-worker list-models --root /path/to/Knowledge
uv run arbor-worker update --root /path/to/Knowledge --model gpt-5.6-sol
```

`update` prints JSONL events to stdout. Exit codes: `0` success, `1` some lectures failed, `3` Codex not authenticated.

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
├── PROJECT.md          # vision and principles
├── python/             # arbor-worker CLI and pipeline
├── desktop/            # Tauri v2 shell + UI
└── docs/               # V1 design spec and implementation plans
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

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| Update button disabled | `codex login`, then `uv run arbor-worker check-auth` |
| Nothing to process | Only **new or changed** `.pdf` / `.pptx` sources trigger work |
| PPTX prepare failed | Export slides as PDF, or install LibreOffice for image fallback |
| Desktop can't find worker | Set `ARBOR_REPO_DIR` to the Arbor repo root |
| Wayland / NVIDIA crash | See [Linux graphics](#linux-graphics-wayland--nvidia) |

---

## License

Not specified yet — private repository.

# Arbor

<img src="docs/brand/arbor-logo-wordmark.png" alt="Arbor" width="160" />

Local-first desktop app that turns course PDFs, PowerPoints, and Word files into structured study digests using CLI providers (Codex CLI, Claude Code, Grok CLI), local models (Ollama, LM Studio), or cloud APIs (OpenAI API, Anthropic API). Your Knowledge library is a normal git repo on disk. Sources and generated notes stay together in history.

**Current release:** [5.3.0](CHANGELOG.md) (package `5.3.0`; tag `v5.3.0`). Version 5 (collaboration) is closed. `v4.5.0` is remote workers over SSH and is cut when that release lands. `v4.4.0` is tagged. The 2026-10-18 Linux live run (boxes C1–C6, and the earlier tutor boxes T1–T7) is recorded on the [implementation checklist](docs/implementation-checklist.md). Worker, desktop, and Tauri all report this number (`arbor-worker --version`). Arbor's viewer limits are advisory; the git host's permissions are the real control. Tables and emphasis were not in any Version 3 live digest. The skill TSV run is still open (issue #70).

**Version 2** (`v2.0.0`) shipped automation on the old UI. **Version 3** shipped as `3.0.0`. `v2.1.0` added the desktop shell. `2.2.0` adds the study loop. `2.3.0` is the fix release after that. **`2.4.0`** is the brand and gate release (tree mark and Linux live-run tag gate). **`2.5.0`** adds Codex, Claude, and Grok CLI providers with a Settings picker. **Version 4** shipped as `v3.1.0` through `v3.5.0` and closed at the Version 4 completion tag (CHANGELOG). **Version 5** shipped as `v4.1.0` through `v4.5.0` and closed at `v5.0.0`. Mac runs are optional and do not block a tag. See [Version numbering](PROJECT.md#version-numbering).

## What's in 2.5.0

Provider registry with Codex CLI, Claude Code CLI, and Grok CLI behind one worker interface. Settings picks **Provider** above **Model**; the top bar shows the selected provider's auth state and docs link.

Package **2.4.0** was the tree mark and Linux live-run gate release. Package **3.0.0** records that run.

For later milestones, see [`PROJECT.md`](PROJECT.md). The original V1 design (`lecture.md` per lecture) is historical: [`docs/superpowers/specs/2026-08-02-arbor-v1-design.md`](docs/superpowers/specs/2026-08-02-arbor-v1-design.md). Living layout is course folders, dated `digests/`, and `arbor-course.json`.

## Download (macOS)

Download the `.dmg` from the [latest GitHub Release](https://github.com/MrF1ow/Arbor/releases/latest). Apple Silicon runner. Pushing a `v*` tag builds the DMG and publishes that Release. Pushes to `main` still upload an `arbor-macos-dmg` artifact from `macos-dmg`.

Install the [Codex CLI](https://developers.openai.com/codex/cli) yourself and log in before the first Update. The app includes `arbor-worker`. It does not include Codex. Signing and notarization stay off until Apple secrets are added, so macOS Gatekeeper may require Open Anyway.

Clone and run from source for Linux, or to develop.

## What's in 2.1.0 (Version 3 shell)

| Area | What you can do |
|------|-----------------|
| Shell | Sidebar library, in-app digest preview, sage/cream UI, collapsed job inspector |
| Ingest | PDF, PPTX, and DOCX. Optional Tesseract OCR on scanned PDF pages. |
| Review | Page ranges, leftover-page suggestions, in-place digest patch. |
| Library | Course folders, dated `digests/`, `course.md`, `arbor-course.json` v2 fingerprints. |
| Watch | Drop a file, wait ~3 seconds, review panel appears. No settings file required. |
| Auto-run | Opt in with `"auto_update": true` in `.arbor/settings.json`. |
| Search | Overlay in the course header. `arbor-worker reindex --root` rebuilds FTS. |
| Jobs | Jobs place in the sidebar with per-run logs. One update at a time. |
| Settings | Watch, auto-run, delete-after-digest, and model in the app. |
| Notify | macOS notification when a job finishes. |

## What's in 2.2.0 (Version 3 study loop)

The 2.1.0 shell plus:

| Area | What you can do |
|------|-----------------|
| Flashcards | Generate a deck. Flip, then Again / Wrong / Mastered. Flip and Next do not grade. |
| Quiz | Generate, Submit. Previous / Next restore the submitted choice. Each question scores once per session. |
| Graph | Concepts and figures. Source chips open Notes. |
| Search | Full-text by default. Semantic toggle uses local embeddings. |
| Citations | Check citations. Unverified badges on invented claims. |
| Source chips | Open Notes and scroll to the cited heading when that heading id exists. |
| Library | Add a class and lecture files from the sidebar. Appearance lives in Settings. |

## What's in 2.3.0

The 2.2.0 study loop, plus the fixes from the 2026-09-20 Mac batch and tighter desktop file handling.

| Area | What changed |
|------|----------------|
| Graph | Concept edges written as labels resolve to node ids. Ambiguous labels fail. |
| Citations | Matching ignores Markdown emphasis and punctuation. |
| Quiz | The toolbar shows this session as `N / M correct`. |
| Library | Reserved class names such as `study` show a visible rejection reason. |
| Notes | Links, tables, and in-pane digest links. Closing page-marker comments stay hidden. |
| Desktop | File reads stay inside the Knowledge root. AI text is escaped. A content security policy is set. |
| Notify | The default capability includes `notification:default`. |

**`v3.0.0` is tagged.** Package **`3.1.0`** is the chat-worker release; **`3.2.0`** is the Chat tab; **`3.3.0`** is review scheduling and weak topics; **`3.4.0`** is study plans, recommendations, and make-card-from-selection; **`3.5.0`** is API and local providers. All of those are tagged. The Version 4 completion package closes the tutor after the 2026-10-18 Linux live run (CHANGELOG). Codex CLI is still a separate install. The gate list is the [implementation checklist](docs/implementation-checklist.md).

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
| **macOS or Linux** | Packaged DMG is macOS. Linux runs from source. Windows is untested |
| **Git** | Knowledge library must be a git repo |
| **Provider** | One of: [Codex CLI](https://developers.openai.com/codex/cli), [Claude Code](https://code.claude.com/docs), [Grok CLI](https://x.ai/grok), [Ollama](http://127.0.0.1:11434), [LM Studio](http://127.0.0.1:1234/v1), OpenAI API, or Anthropic API. CLI providers must be installed and signed in. API keys are entered in Settings, stored in the OS keyring, and are not written to `.arbor` or `settings.json` |
| **Python ≥ 3.11** | Worker runtime |
| **[uv](https://docs.astral.sh/uv/)** | Installs and runs the Python worker |
| **Rust + cargo** | Tauri desktop shell ([rustup](https://rustup.rs/)) |
| **Node.js 22.6+** and **npm** | Desktop frontend build and tests |

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

You can use [Claude Code](https://code.claude.com/docs), [Grok CLI](https://x.ai/grok), [Ollama](http://127.0.0.1:11434), [LM Studio](http://127.0.0.1:1234/v1), OpenAI API, or Anthropic API instead of Codex. In **Settings**, choose **Provider** above **Model**. CLI providers sign in outside the app (`claude auth status`, `grok models`, and so on). For OpenAI API and Anthropic API, enter the key in Settings; it is stored in the OS keyring and is not written to `.arbor` or `settings.json`.

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
cd desktop
npm install
npm run tauri dev
```

Dev builds locate `python/` by walking up from the desktop crate. Set `ARBOR_REPO_DIR` to the repo root only if that walk would be wrong.

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
    settings.json         # delete_sources_after_digest, auto_update, watch_enabled
```

**Format guidance:**

- **PDF** — best for annotated lectures (ink, handwriting).
- **PPTX** — best for clean slide decks with real text on slides.
- **DOCX** — Word notes and readings.

---

## Using the app

1. **Codex auth** — Red badge means Update is disabled. Run `codex login`, then refocus the app.
2. **Pick folder** — Select your Knowledge root.
3. **Choose model** — Dropdown lists models from `.arbor/models.json` (optional) or built-in defaults.
4. **Update Knowledge** — review detected files, edit page ranges per source
   (`151-300`, `40-55, 120-122`), then Confirm. Clean appends pre-fill the new tail.
   Ambiguous alignment shows a note; set ranges yourself. Blank on a new file is
   the whole file. Blank on a truncated file does no work.
5. **Folder watch** — With the app open, drop a PDF, PPTX, DOCX, or Markdown file into a course folder. After about 3 seconds the review panel appears. Confirm as usual. Silent auto-run needs `"auto_update": true`.
6. **Search** — Type in **Search knowledge**. Reindex rebuilds the FTS index from markdown.
7. **Recent runs** — Expand a row for that job's log.
8. **Cancel** — Stops after the current range or digest action finishes. Completed work is kept.
9. **Open folder** — Opens the Knowledge root in your file manager.

---

## Workers

Settings → Workers stores SSH hosts. Each knowledge root uses **Local** (the default) or one saved host.

A host has a label, host, port, optional user, optional identity file, a worker command (for example `uv run --project /path/to/python arbor-worker`), and a remote root.

**Test connection** runs that command with `--version` and shows the version.

Update and study jobs on a remote root copy the course sources to `remote_root/<root-id>/<course>/`, run the worker with `--no-commit`, stream the same NDJSON events, copy digests and study files back, then commit on the local Knowledge tree. Embed stays on this machine.

**Cancel** stops the remote process.

Host keys are written to an Arbor-managed `known_hosts` file under the app data directory. Arbor does not read or write `~/.ssh/known_hosts`.

The worker command is not passed through a shell. Values that start with `-` are rejected except tokens inside the worker command itself.

Provider API keys are not placed on the SSH command line. The remote worker uses whatever login that machine already has.

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
| `ARBOR_REPO_DIR` | Optional repo-root override containing `python/` (dev builds walk up to find it) |
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
├── CHANGELOG.md        # package releases (2.0.0, …)
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

Create `.arbor/models.json` in your Knowledge root.

A flat `models` list still applies to **Codex** only:

```json
{
  "models": [
    { "id": "gpt-5.6-sol", "label": "Sol 5.6" },
    { "id": "gpt-5.6-terra", "label": "Terra 5.6" }
  ]
}
```

Optional per-provider overrides:

```json
{
  "providers": {
    "codex": [{ "id": "gpt-5.6-sol", "label": "Sol 5.6" }],
    "claude": [{ "id": "claude-sonnet-5-5", "label": "Sonnet 5.5" }],
    "grok": [{ "id": "grok-4.7", "label": "Grok 4.7" }]
  }
}
```

When `providers.<id>` is present, it wins for that provider. Flat `models` does not apply to Grok or Claude.

Model IDs must match what the selected CLI accepts.

`.arbor/settings.json` holds worker options. Missing keys, and a missing file, use these defaults:

```json
{
  "delete_sources_after_digest": false,
  "auto_update": false,
  "watch_enabled": true
}
```

`watch_enabled` keeps folder watch on so a dropped file opens the review panel. `auto_update` is off unless you opt in. Set `delete_sources_after_digest` to `true` to delete each source file after it is successfully digested.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| Update button disabled | Sign in to the provider selected in Settings (`codex login`, `claude auth status`, or `grok models`), then refocus Arbor |
| Nothing to process | Only new, changed, or leftover-page sources trigger work |
| Wrong page window | Check `suggested_ranges` from `plan-update`. Blank is whole-file only for new sources, not truncation. |
| PPTX prepare failed | Export slides as PDF, or install LibreOffice for image fallback |
| Desktop can't find worker | Packaged app uses the bundled sidecar. From a clone, `tauri dev` walks up to `python/`. If that fails, set `ARBOR_REPO_DIR` to the Arbor repo root |
| Watch stays silent | Folder selected; wait 3s. Missing settings.json still watches. Set `"watch_enabled": false` only to disable. |
| Wayland / NVIDIA crash | See [Linux graphics](#linux-graphics-wayland--nvidia) |

---

## License

Not specified yet — private repository.

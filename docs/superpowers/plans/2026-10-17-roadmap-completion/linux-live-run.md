# Linux live run (replaces the Mac batch as the tag gate)

One recorded run of the real Tauri app on this Linux machine per closing tag (`v3.0.0`, `v4.0.0`, `v5.0.0`). Record results in a dated section at the bottom of this file and tick the checklist `Live run` column.

## Setup

```bash
cd desktop && npm install && npm run tauri dev
```

- Provider: **Grok CLI, `grok-4.7`**. Never Claude from an agent session; Codex is unavailable here.
- Knowledge root: a scratch folder, e.g. `/tmp/arbor-live/Knowledge`, `git init`'d.
- Fixtures: a small multi-page PDF, a PPTX, a DOCX, a scanned-image PDF (for OCR), and one long lecture (>25 pages, to hit chunking). Keep them under `python/tests/fixtures/live/` if license-clean, otherwise point to a local folder.
- The agent drives the window with screenshots (`grim` on Wayland) and records the job history export; the user may run it by hand instead.

## Version 3 script (`v3.0.0`)

| # | Box | Pass when |
|---|-----|-----------|
| 1 | Ingest PDF/PPTX/DOCX, commit | Dated digests written, git commit created, job history shows success |
| 2 | Long digest + chunking | >25-page PDF digests; Notes pane scrolls to the end |
| 3 | `course.md` | One-digest index link opens the digest in Notes; two digests roll up |
| 4 | Markdown | Tables, nested lists, emphasis, code, links render; no closing `arbor-pages` text |
| 5 | Search | FTS hit opens from overlay; semantic search returns the right lecture |
| 6 | Watch | Dropping a file into the course folder lands in review |
| 7 | Flashcards | Generate, flip, Again / Wrong / Mastered persist |
| 8 | Quiz | Generate, submit, session score `N / M correct` |
| 9 | Concepts / graph | Concepts job succeeds; graph chip navigates |
| 10 | Diagrams + citations | Figure merge visible; honest cards not marked Unverified |
| 11 | Classes | Add class works; reserved name (`study`) shows the error |
| 12 | Notifications | Desktop notification on job end (Linux notification daemon) |
| 13 | OCR | Scanned PDF yields text (Tesseract installed) |
| 14 | Packaged build | `npm run tauri build` on Linux produces an AppImage/deb that launches without the repo or `uv` (sidecar proof, Linux equivalent of the Finder box) |
| 15 | Auth states | Grok signed out → badge shows not signed in and jobs refuse with the provider's message |

## Version 4 / 5 scripts

Appended by [v4-tutor.md](v4-tutor.md) and [v5-collaboration.md](v5-collaboration.md).

## Runs

### 2026-10-17 — `release/v3.0.0` (package still `2.5.0` during the run)

Private Xvfb `:97` (1600x1000), private D-Bus session, `CLAUDECODE=1`, Grok `grok-4.7`. No `hyprctl dispatch`. Screenshots with `magick import -display :97`. Knowledge root `/tmp/arbor-live/Knowledge` (pre-seeded; the folder picker never accepted Open). Real `~/.config/com.arbor.app/settings.json` was not edited.

| # | Result | Evidence |
|---|--------|----------|
| 1 | Pass, after `7330487` (Grok tool denylist) | Digests committed `890ae94`, `8e8e2fc`, `c5ec0d5`. DOCX digest omitted `DOCTOKEN` (model omission, job succeeded). |
| 2 | Pass | Job `job-18df789d906e3238`: chunks pages 1–25 and 26, then synthesis. `Chunks/digests/2026-10-18.md` contains `PAGE26TOKEN`. Notes scrolled to that line: `/tmp/arbor-live/shots/93-end.png`. |
| 3 | Pass | One-digest index link opened the digest. Later digests rolled up in `course.md`. |
| 4 | Partial | Nested lists, inline code, and links rendered. Closing `arbor-pages` text was absent. No digest contained a table or emphasis, so those two constructs were not proven. Not marked Live run. |
| 5 | Pass | FTS `SLIDETOKEN` and semantic “chloroplasts” opened the mesophyll digest (`/tmp/arbor-live/shots/41-42`). |
| 6 | Pass | `watch-handout.pdf` landed in review. Confirming the figure PDF later digested that handout as well. |
| 7 | Pass | Generate, flip, Again, Wrong, Mastered. Progress in `.arbor/progress/Botany.flashcards.json`. |
| 8 | Pass | Submit showed `1 / 10 correct`. Commit `65b82e8`. |
| 9 | Pass, after `88c77fd` (bare digest filenames) | Concepts commit `0444eef`. Graph chip opened the digest (`/tmp/arbor-live/shots/75-77`). |
| 10 | Pass, with a citation caveat, after `3de4526` (prompt file) and `327b62b` (JSON preamble) | Figure “Copperleaf stomata” in the graph (`/tmp/arbor-live/shots/87-figure-detail.png`, knowledge commit `14f329c`). The copperleaf card was not marked Unverified (`/tmp/arbor-live/shots/88-honest-card.png`). Three of 32 cards were flagged for paraphrase or a pronoun, not for the `**copperleaf**` vs `Copperleaf.` case. |
| 11 | Pass | Add class worked. Reserved name `study` showed the error (`/tmp/arbor-live/shots/19`). |
| 12 | Pass | Job-end notifications on the private bus only (`/tmp/arbor-live/logs/notifications.log`). |
| 13 | Pass | Scanned PDF job `job-18df78bb41e9f011`. Digest contains `OCRTOKEN`. `/tmp/arbor-live/shots/95-ocr.png`. The model’s preamble is still visible above the heading. |
| 14 | Pass | `Arbor_2.5.0_amd64.AppImage` and `Arbor_2.5.0_amd64.deb`. Both contain `usr/bin/arbor-worker` beside `desktop`. Launched on `:97` with `PATH=/bin` (no repo, no `uv`). AppImage worker was `/tmp/appimage_extracted_…/usr/bin/arbor-worker`. Deb sidecar `--version` printed `2.5.0` and `check-auth --provider grok` returned authenticated. Shots `103-appimage.png`, `105-deb-settled.png`. `linuxdeploy` strip failed on RELR libraries; rebuild used `NO_STRIP=1`. The deb was not installed with dpkg. |
| 15 | Pass, after `ab65bac` | Badge “Grok · not signed in” (`96-signed-out.png`). Confirm logged `Grok is not authenticated: not logged in` and created no job (`102-scrolled.png`). |

`ARBOR_PATH_PREFIX` does not win: the worker prepends `~/.local/bin` before `PATH`, and that directory holds the real `grok` symlink. The signed-out launch used a private mount namespace that bind-mounted a fake `grok` over those two symlinks. Outside the namespace the real symlinks were unchanged. The real Grok CLI was not logged out.

Hyprland `arbor` client count was 0 after every launch in this run. The first dev launch in the previous segment briefly had a portal speak Hyprland protocols; no Arbor window was placed on the real session and no dispatch was sent.

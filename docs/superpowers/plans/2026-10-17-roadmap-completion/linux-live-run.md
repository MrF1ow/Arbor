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

_(none yet)_

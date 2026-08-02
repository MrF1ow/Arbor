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

## Manual test checklist (real Codex)

1. **Auth blocks work:** with Codex logged out, the badge is red, shows the reason and a
   "Set up Codex" link, and **Update Knowledge** stays disabled.
2. **Auth passes:** `codex login`, refocus the window → badge turns green, button enables.
3. **Pick folder:** choose an empty folder → log shows "Initialized git repository".
4. **Process a PDF:** put an annotated lecture at `Course/Lecture 01/source.pdf`, click
   Update → stages stream, `lecture.md` + `metadata.json` appear, a `digest:` commit is made.
5. **Process a PPTX:** clean deck at `Course/Lecture 02/slides.pptx` → digest produced via
   the text path (`metadata.json` shows `pptx_text`).
6. **Model selection:** switch the dropdown, run again on a changed source → `metadata.json`
   records the new `model_id`.
7. **Idempotency:** click Update with no changes → "Nothing to process".
8. **Cancel:** with two changed sources, click Cancel after the first → only the first is
   committed; log shows "Cancelled".
9. **Open folder:** click Open → the Knowledge folder opens in the file manager.

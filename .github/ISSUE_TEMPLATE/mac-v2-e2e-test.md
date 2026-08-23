---
name: Mac V2 E2E test checklist
about: Manual end-to-end testing for Version 2 on macOS
title: "Mac E2E test: Version 2"
labels: testing
assignees: ''
---

## Summary

Manual end-to-end test plan for **Version 2** on a MacBook. Verify search, folder watch, job history, notifications, Word ingest, and optional OCR.

**Important:** Use the **2.0.0** DMG (`v2.0.0`) or run from **`main` in dev**. The older [1.0.0 DMG](https://github.com/MrF1ow/Arbor/releases/tag/v1.0.0) is Version 1 only.

Related: [V2 program plan](docs/superpowers/plans/2026-08-19-v2-automation/overview.md), [desktop manual checklist](desktop/README.md).

---

## 1. One-time setup

### Prerequisites

```bash
# Xcode Command Line Tools (if needed)
xcode-select --install

# Rust, Node, uv, git
brew install rust node uv git
```

### Codex CLI (required for real digests)

Follow [Codex CLI docs](https://developers.openai.com/codex/cli):

```bash
codex login
codex exec --help
```

### Optional (V2 extras)

```bash
brew install tesseract          # OCR on scanned PDFs
brew install --cask libreoffice # thin PPTX image fallback
```

### Clone and run V2 from source

```bash
git clone git@github.com:MrF1ow/Arbor.git
cd Arbor
git checkout main
git pull

cd python && uv sync
uv run arbor-worker check-auth    # expect "authenticated": true

cd ..
export ARBOR_REPO_DIR="$(pwd)"
cd desktop && npm install && npm run tauri dev
```

Keep the terminal open. The app window should launch.

---

## 2. Create a test Knowledge library

Use a **fresh empty folder**, not real course notes:

```bash
mkdir -p ~/Desktop/ArborTest/Knowledge/Biology
```

In the app:

1. **Choose folder…** → select `~/Desktop/ArborTest/Knowledge`
2. Log should show git initialization
3. Codex badge should turn green after login

Add test sources (Finder or terminal):

```bash
cp /path/to/lecture.pdf ~/Desktop/ArborTest/Knowledge/Biology/mega.pdf
cp /path/to/slides.pptx  ~/Desktop/ArborTest/Knowledge/Biology/week1.pptx
cp /path/to/notes.docx   ~/Desktop/ArborTest/Knowledge/Biology/readings.docx
```

---

## 3. V1 core loop (baseline)

| Step | Action | Expected |
|------|--------|----------|
| Auth gate | Log out of Codex, try Update | Button disabled, red badge |
| Auth pass | `codex login`, refocus app | Green badge, Update enabled |
| Plan | Click **Update Knowledge** | Review panel lists files + page counts |
| Ingest | Confirm with blank ranges | Progress log; `Biology/digests/<date>.md` created |
| Git | Check folder | `git log -1` shows `digest: Biology` |
| Idempotent | Update again, no changes | "Nothing to process" |

Verify on disk:

```bash
ls ~/Desktop/ArborTest/Knowledge/Biology/digests/
cat ~/Desktop/ArborTest/Knowledge/Biology/course.md
cat ~/Desktop/ArborTest/Knowledge/Biology/arbor-course.json
ls ~/Desktop/ArborTest/Knowledge/.arbor/arbor.db
```

---

## 4. V2 feature tests

### A. Job history (Wave 1)

- [ ] Run Update → Confirm
- [ ] **Recent runs** panel shows a row with status `succeeded`
- [ ] Click **Log** → JSONL from that run appears
- [ ] Start a second Update while one is running → rejected ("already running")

### B. Search + reindex (Wave 2)

- [ ] After digest, search for a word from the digest in **Search knowledge**
- [ ] Results show course, path, snippet
- [ ] Click a result → course folder opens in Finder
- [ ] Click **Reindex** → log reports document count
- [ ] Search again → same hits (rebuild works)

CLI cross-check:

```bash
cd Arbor/python
uv run arbor-worker reindex --root ~/Desktop/ArborTest/Knowledge
```

### C. Folder watch (Wave 3)

Default: **watch → review**, not silent auto-run.

- [ ] App open, folder selected
- [ ] Drop a new PDF into `Biology/` in Finder
- [ ] Wait ~3 seconds
- [ ] Log: "Folder watch detected N file(s)"
- [ ] Review panel appears with the new file
- [ ] Confirm → normal ingest

**Optional auto-run test** (opt-in; uses Codex credits):

```bash
mkdir -p ~/Desktop/ArborTest/Knowledge/.arbor
cat > ~/Desktop/ArborTest/Knowledge/.arbor/settings.json <<'JSON'
{
  "auto_update": true,
  "watch_enabled": true
}
JSON
```

- [ ] Drop another new file → job starts without clicking Update
- [ ] Set `"auto_update": false` when done

### D. Notifications (Wave 3)

- [ ] macOS **System Settings → Notifications** → allow Arbor (or dev app name)
- [ ] Complete an Update
- [ ] OS notification: "Arbor update finished" (or failed/cancelled)

### E. Word `.docx` (Wave 4)

- [ ] Put a `.docx` with readable text in `Biology/`
- [ ] Update → review → Confirm
- [ ] New digest + manifest entry created

### F. OCR (Wave 4, optional)

Requires `brew install tesseract`.

- [ ] Use a scanned PDF (image-only, no selectable text)
- [ ] Update → Confirm
- [ ] Digest still produced (may be slower)

---

## 5. Worker-only checks (optional)

```bash
cd Arbor/python
export ROOT=~/Desktop/ArborTest/Knowledge

uv run arbor-worker plan-update --root "$ROOT"
uv run arbor-worker reindex --root "$ROOT"
```

---

## 6. Packaged Mac build

To test the 2.0.0 DMG:

- Download the `v2.0.0` GitHub Release, or
- Build locally: `cd desktop && npm run tauri build`, or
- Download the **`arbor-macos-dmg`** artifact from a CI run on `main`

Codex stays a separate install. Gatekeeper may require **Open Anyway** for unsigned builds.

---

## 7. Done when

- [ ] Full PDF ingest with git commit
- [ ] Job in **Recent runs** with expandable log
- [ ] Search finds text across courses
- [ ] Reindex succeeds
- [ ] File drop triggers watch → review (optional: auto-run)
- [ ] Notification on job finish
- [ ] `.docx` ingests
- [ ] (Optional) scanned PDF with Tesseract

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Update disabled | `codex login`, refocus app |
| Worker not found in dev | `export ARBOR_REPO_DIR="$(pwd)"` from repo root before `tauri dev` |
| No V2 UI | Old DMG; run from `main` with `tauri dev` |
| Watch silent | Folder selected; wait 3s. A missing settings file still watches. Set `"watch_enabled": false` to disable. |
| No notifications | Enable in System Settings |
| OCR skipped | `brew install tesseract` |

---

## Report results

Comment below with:

- macOS version + Apple Silicon vs Intel
- Dev (`tauri dev`) vs DMG
- Checklist items passed / failed
- Screenshots or log snippets for failures

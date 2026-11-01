# Linux live run (replaces the Mac batch as the tag gate)

One recorded run of the real Tauri app on this Linux machine per closing tag (`v0.3.0`, `v0.4.0`, `v0.5.0`). Record results in a dated section at the bottom of this file and tick the checklist `Live run` column.

## Setup

```bash
cd desktop && npm install && npm run tauri dev
```

- Provider: **Grok CLI, `grok-4.7`**. Never Claude from an agent session; Codex is unavailable here.
- Knowledge root: a scratch folder, e.g. `/tmp/arbor-live/Knowledge`, `git init`'d.
- Fixtures: a small multi-page PDF, a PPTX, a DOCX, a scanned-image PDF (for OCR), and one long lecture (>25 pages, to hit chunking). Keep them under `python/tests/fixtures/live/` if license-clean, otherwise point to a local folder.
- The agent drives the window with screenshots (`grim` on Wayland) and records the job history export; the user may run it by hand instead.

## Version 3 script (`v0.3.0`)

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

## Version 4 script (`v0.4.0`)

From [v4-tutor.md](v4-tutor.md). Behavioral Medicine was not on this machine. The 2026-10-18 run used a fresh fixture course, Saltmarsh, built from three multi-page lecture PDFs ingested through the app with Grok `grok-4.7`.

| # | Box | Pass when |
|---|-----|-----------|
| T1 | Covered question | Concise answer with a clickable digest/page citation that opens Notes at the heading |
| T2 | Uncovered question | Explicit "not supported" |
| T3 | Explain and Quiz | Both stay within course material. The next turn grades the quiz answer and does not ask a new question |
| T4 | History | Persists across a restart. New and Clear work |
| T5 | Read-only chat | Knowledge folder unchanged by chat (`git status` clean apart from `.arbor/`) |
| T6 | Study loop on the fresh course | Due today deck, weak topics (grade some cards wrong first), study plan, and make-card-from-selection |
| T7 | Signed-out provider | Chat shows the auth state |

## Version 5 script (`v0.5.0`)

From [v5-collaboration.md](v5-collaboration.md). One bare remote and two clones (machines A and B) of one shared library. A third personal root C is only for the SSH worker. One app process; switch the active root. Provider Grok `grok-4.7`.

| # | Box | Pass when |
|---|-----|-----------|
| C1 | Import and sync | A imports a lecture and syncs. B pulls and sees the digest. Search and embeddings are rebuilt on B |
| C2 | Conflict | Both edit the same digest line. The conflict view resolves it, the resolution is pushed, and the other side receives it |
| C3 | Per-user progress | Both grade the same card differently, sync, and each keeps their own progress |
| C4 | Marketplace skill | Install the Anki skill from a local bare index, confirm permissions, run it (TSV written), uninstall |
| C5 | Viewer | With B set to viewer, B cannot run write jobs. The UI is disabled with the reason, and the worker refuses |
| C6 | Remote worker | A private sshd on localhost digests a PDF. `~/.ssh` is unchanged |

## Runs

### 2026-10-17 — `release/v3.0.0` (package still `0.2.5` during the run)

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
| 14 | Pass | `Arbor_0.2.5_amd64.AppImage` and `Arbor_0.2.5_amd64.deb`. Both contain `usr/bin/arbor-worker` beside `desktop`. Launched on `:97` with `PATH=/bin` (no repo, no `uv`). AppImage worker was `/tmp/appimage_extracted_…/usr/bin/arbor-worker`. Deb sidecar `--version` printed `0.2.5` and `check-auth --provider grok` returned authenticated. Shots `103-appimage.png`, `105-deb-settled.png`. `linuxdeploy` strip failed on RELR libraries; rebuild used `NO_STRIP=1`. The deb was not installed with dpkg. |
| 15 | Pass, after `ab65bac` | Badge “Grok · not signed in” (`96-signed-out.png`). Confirm logged `Grok is not authenticated: not logged in` and created no job (`102-scrolled.png`). |

`ARBOR_PATH_PREFIX` does not win: the worker prepends `~/.local/bin` before `PATH`, and that directory holds the real `grok` symlink. The signed-out launch used a private mount namespace that bind-mounted a fake `grok` over those two symlinks. Outside the namespace the real symlinks were unchanged. The real Grok CLI was not logged out.

Hyprland `arbor` client count was 0 after every launch in this run. The first dev launch in the previous segment briefly had a portal speak Hyprland protocols; no Arbor window was placed on the real session and no dispatch was sent.

### 2026-10-18 — `release/v4.0.0` (package still `0.3.5` during the run)

Private Xvfb `:97` (1600x1000), private D-Bus session, `CLAUDECODE=1`, Grok `grok-4.7`. No `hyprctl dispatch`. Screenshots with `magick import -display :97`. Knowledge root `/tmp/arbor-v4/Knowledge` (`git init`, empty until the app ingested sources). Course **Saltmarsh**. Behavioral Medicine was not available, so three multi-page lecture PDFs (tidal frame, fiddler crabs, wrack) were generated and ingested through the app. Real `~/.config/com.arbor.app/settings.json` stayed byte-identical (`87c2bcd705df9bebaa657bb89c3010e4cc90069b71f568af35a52d8883a2759b`). No product bug. No Composer fix.

| # | Result | Evidence |
|---|--------|----------|
| T1 | Pass | Ask: “What is the carbon burial rate on the Winyah accretion terrace?” Answer: “218 grams of carbon per square meter per year [1][2].” Chips `course.md · saltmarsh` and `2026-10-18T0545.md · important-details · p. 1-3`. The page chip opened Notes on “Important Details”. `/tmp/arbor-v4/shots/T1-answer.png`, `T1-notes.png`. |
| T2 | Pass | “What is the boiling point of tungsten?” Answer says the sources do not state it. Banner text is “Not supported by this course”. `/tmp/arbor-v4/shots/T2-answer.png`. |
| T3 | Pass | Explain of Spartina zonation stayed in the course and cited `course.md` (`T3-explain.png`). Quiz asked one question (August stem density and canopy height, `T3-quiz-question.png`). The next turn graded “Correct” with digest and page citations and did not ask another question (`T3-quiz-grade.png`). |
| T4 | Pass | After a full restart the Chat tab still showed the transcript (`T4-history.png`). New chat emptied the visible log and appended a session line (`T4-new.png`). Clear history confirmed in the dialog (`T4-clear-dialog.png`) and deleted `.arbor/chat/Saltmarsh.jsonl` (`T4-cleared.png`). |
| T5 | Pass | After the chat session, before study writes: `git status` was only untracked `.arbor/arbor.db`, `.arbor/chat/Saltmarsh.jsonl`, and `.arbor/settings.json`. No tracked diff. `/tmp/arbor-v4/shots/T5-git-status.png`, `/tmp/arbor-v4/shots/T5-git-status.txt`. |
| T6 | Pass | Flashcard job `job-18df8acbad2b6fbc` committed `d8b11c2` (36 cards). Due today started at 36 (`T6-due.png`). Three Wrong grades left Due today at 33 and listed weak topics Important Details, Key Concepts, and Overview (`T6-graded.png`, `T6-weak.png`). Generate wrote `Saltmarsh/study/plan.md` and the overview rendered it (`T6-plan.png`). Make card from a digest selection saved `fc_ad8768d2` and the deck showed it as 34 of 34, Due today 34, full deck 37, with a page chip (`T6-make-card.png`, `T6-card-saved.png`). |
| T7 | Pass | Signed-out launch (mount namespace, fake `grok`). Chat badge “Grok · not signed in” with Set up (`T7-auth.png`). The fake binary logged `models` twice and exited 1. Outside the namespace the real Grok CLI still printed “You are logged in with grok.com.” |

Ingest used folder watch plus Confirm. The GTK Open File dialog on `:97` is modal and was not used for the import. The update job generated all three digests and `course.md`, then failed at `git commit` because the isolated `XDG_CONFIG_HOME` hid `~/.config/git/config`. Local identity was set only in `/tmp/arbor-v4/Knowledge`, and the already-written digest was committed as `5d98970`. Settings Reindex indexed 4 documents. Embed did not run. FTS plus `course.md` was enough for the page citation. The study-plan command and make-card append write files and do not commit them, so `plan.md`, `progress.json`, and the appended card stayed untracked or unstaged after T6. That is after the T5 snapshot.

`ARBOR_PATH_PREFIX` does not hide `grok`: the worker prepends `~/.local/bin` and `~/.grok/bin`. T7 bind-mounted a fake `grok` over both symlinks inside a user mount namespace. The real symlinks were unchanged outside it. The real Grok CLI was not logged out.

Hyprland client count for Arbor was 0. Two exact-pid restarts (`pgrep -x desktop` only) cleared a stuck Open File dialog. Xvfb `:97` stayed up. No `hyprctl dispatch`.

### 2026-10-18 — `release/v5.0.0` (package `0.4.5` during the run, then `0.5.0`)

Private Xvfb `:97` (1600x1000) inside `dbus-run-session`. `WAYLAND_DISPLAY` and `HYPRLAND_INSTANCE_SIGNATURE` unset, `GDK_BACKEND=x11`, `CLAUDECODE=1`, Grok `grok-4.7`. Home, XDG, and `GIT_CONFIG_GLOBAL` under `/tmp/arbor-v5/`. Screenshots with `magick import -display :97`. No `hyprctl dispatch`. One app process. Switching the sidebar root switches the machine. Real `~/.config/com.arbor.app/settings.json` stayed `87c2bcd705df9bebaa657bb89c3010e4cc90069b71f568af35a52d8883a2759b`.

Setup: bare remote `/tmp/arbor-v5/remote.git`. Clone A `owner-a@arbor.test` (owner). Clone B `member-b@arbor.test` (editor, then viewer for C5). Shared library Lumen. Personal root C (`/tmp/arbor-v5/C`, RemoteLab) bound to worker `wlive` (127.0.0.1:22222, identity `/tmp/arbor-v5/ssh/client_key`). Lecture fixture `lumen-lecture.pdf` (Mosquito Bay, marker `PYRODINIUMTOKEN`). Remote-worker fixture `remote-lamp.pdf` (marker `REMOTEWORKERTOKEN`, 590-nanometer sodium lamp). Marketplace index `/tmp/arbor-v5/market-index.json` points `anki-export` at `file:///tmp/arbor-v5/market.git` pin `429d15dc5a6fde7c61559fc787a737cd0c94414d`.

| # | Result | Evidence |
|---|--------|----------|
| C1 | Fail, then fixed in `1e06fd3` | A digested and embedded (job `job-18dfa8da0600a4ee`, commit `a6ddc8e`), then synced. B pulled the digest and FTS found `PYRODINIUMTOKEN` (`/tmp/arbor-v5/shots/C1-b-fts.png`). Semantic search on B returned "No results" because `.arbor/vectors.sqlite` is gitignored and a first pull did not create it (`C1-b-semantic.png`). `1e06fd3` always reindexes and embeds after a head-changing sync. After that code was on the worker, B's semantic search for `PYRODINIUMTOKEN` returned the Lumen digest with Semantic checked (`C1-b-semantic-reproof.png`). |
| C2 | Pass | A and B edited the same digest line (`PYRODINIUMTOKEN-A` / `PYRODINIUMTOKEN-B`). Sync opened the conflict dialog for `Lumen/digests/2026-10-18.md` (`C2-dialog-full.png`). Use mine, then Continue sync. Remote and A landed on `9652ddf` with the line `PYRODINIUMTOKEN-B` (`C2-a-got-it.png`). |
| C3 | Pass | A committed one card `fc_live1` (`4e30b87`) and synced. B pulled it. B graded Mastered (`correct` 1, `wrong` 0, commit `276775e`, author `member-b@arbor.test`). A graded Wrong (`correct` 0, `wrong` 1, commit `1d46801`, author `owner-a@arbor.test`). Merge `200b626` is on both clones. Each file is `.arbor/users/<email>/Lumen/progress.json` and the two grades still differ after the round trip. Shots `c3-b-flipped.png`, `C3-a-after-wrong.png`, `C3-b-after-mastered.png`. |
| C4 | Install, confirm, and uninstall passed. Run blocked | Browse of the local index listed Anki export. Install wrote `$XDG_DATA_HOME/arbor/skills/anki-export/429d15dc…` and the status said Installed (`c4-installed.png`). Confirm permissions persisted the grant (`c4-confirmed.png`). Run opened Select Folder. Ctrl+L accepted `/tmp/arbor-v5/export` (`c4-picker-ctrll.png`). Open, Cancel, Escape, and Alt+O did not dismiss the dialog (issue #70). The export directory stayed empty. Uninstall removed the skill directory and the grant (`C4-uninstalled.png`). Not marked Live run. |
| C5 | Pass | Owner A set `member-b@arbor.test` to viewer and saved (`5410923`). B pulled. Update knowledge is disabled and the course shows the viewer reason (`C5-viewer-disabled.png`). `arbor-worker append-card` on B exited 1 with `Viewers cannot run write jobs or push…`. The deck stayed one card. |
| C6 | Pass, with a marker caveat | Confirm on `remote-lamp.pdf` started `job-18dfaa64594062fc`. The private sshd on 127.0.0.1:22222 accepted the throwaway key. The remote tree is `/tmp/arbor-v5/ssh-work/0b0f395f328ef743/`, and its page images contain `REMOTEWORKERTOKEN`. Local commit `66a1e28` is `digest: RemoteLab`. The digest states the 590-nanometer sodium lamp (`C6-after-job.png`). Grok did not copy the literal marker into the digest. `~/.ssh` before and after match (sha256 and mtime of every entry). System sshd pid 1060 was untouched. |

## Folder picker under Xvfb

Issue #70, checked 2026-10-30 on a v0.5.31 debug build (`cd desktop && npm run tauri build -- --debug --no-bundle`) on private Xvfb displays with `dbus-run-session`, `GDK_BACKEND=x11`, `WAYLAND_DISPLAY` unset, and scratch `HOME` and XDG dirs. No window manager. The real `~/.config/com.arbor.app/settings.json` was not touched.

**Cause.** Every folder picker called the dialog without a start folder, so GTK 3.24 opened it on Recent. In `SELECT_FOLDER` mode on Recent, Open stays disabled, and a path typed after Ctrl+L never enables it. Return only activates that disabled button. That is the v3 and v5 "never accepts Open" result (C4's export picker too), and a person who presses Ctrl+L and Enter from Recent hits it as well. Window focus made no difference. A minimal rfd program with `set_directory` accepted a typed path, which is what pointed at the start folder.

**Fix.** `openDialog` in `desktop/src/lib/ipc.ts` now starts every folder picker in the home folder when the caller gives no `defaultPath`. On the fixed build the dialog opens on Home with Open enabled. Ctrl+L, typing `/tmp/zz70audit/leaf`, and Return saved that folder as the Knowledge root and ran `git init` in it.

Driver notes for live runs:

- Type paths slowly (`xdotool type --delay 150`). At a 40 ms delay, GTK's inline completion can duplicate a path component when sibling names share a prefix.
- Clicking a folder row and then Open also works, and does not depend on the location entry.

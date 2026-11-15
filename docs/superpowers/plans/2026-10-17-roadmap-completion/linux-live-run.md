# Linux live run (replaces the Mac batch as the tag gate)

One recorded run of the real Tauri app on this Linux machine per closing tag (`v0.3.0`, `v0.4.0`, `v0.5.0`). Record results in a dated section at the bottom of this file and tick the checklist `Live run` column.

## Setup

```bash
cd desktop && npm install && npm run tauri dev
```

- Provider: **Claude Code provider** (the `claude` CLI, `claude-sonnet-5-5`, on the user's Claude plan). Under a scratch `HOME`, copy only `~/.claude/.credentials.json` into `<scratch HOME>/.claude/` (mode 600). Codex is tested with fakes only. The run records below are history from when Grok was the provider.
- Claude runs need `CLAUDECODE` unset in the app's environment: the app refuses the Claude provider when `CLAUDECODE=1`. Launch with `env -u CLAUDECODE`, and when `claude` is the mise wrapper also set `MISE_TRUSTED_CONFIG_PATHS`. Run the pre-check from the arbor-test skill under that same env first.
- Knowledge root: a scratch folder, e.g. `/tmp/arbor-live/Knowledge`, `git init`'d.
- Fixtures: a small multi-page PDF, a PPTX, a DOCX, a scanned-image PDF (for OCR), and one long lecture (>25 pages, to hit chunking). Keep them under `python/tests/fixtures/live/` if license-clean, otherwise point to a local folder.
- The agent drives the window with screenshots (`magick import -display :<n>` on a leased Xvfb display; never `grim` the real outputs) and records the job history export; the user may run it by hand instead.

## Version 3 script (`v0.3.0`)

| # | Box | Pass when |
|---|-----|-----------|
| 1 | Ingest PDF/PPTX/DOCX, commit | Dated digests written, git commit created, job history shows success |
| 2 | Long digest + chunking | >25-page PDF digests; Notes pane scrolls to the end |
| 3 | `course.md` | One-digest index link opens the digest in Notes; two digests roll up (a synthesized `course.md` with no digest links by design; each digest opens from the lecture list) |
| 4 | Markdown | Tables, nested lists, emphasis, code, links render; no closing `arbor-pages` text |
| 5 | Search | FTS hit opens from overlay; semantic search returns the right lecture (turn on Settings → General → Embed after Update and run an update first: v0.6 has no manual Embed button and semantic search shows a bare "No results" without `.arbor/vectors.sqlite`) |
| 6 | Watch | Dropping a file into the course folder lands in review |
| 7 | Flashcards | Generate, flip, Again / Wrong / Mastered persist |
| 8 | Quiz | Generate, submit, session score `N / M correct` |
| 9 | Concepts / graph | Concepts job succeeds; graph chip navigates |
| 10 | Diagrams + citations | Figure merge visible; honest cards not marked Unverified |
| 11 | Classes | Add class works; reserved name (`study`) shows the error |
| 12 | Notifications | Desktop notification on job end (Linux notification daemon) |
| 13 | OCR | Scanned PDF yields text (Tesseract installed) |
| 14 | Packaged build | `bash scripts/bundle-worker.sh`, then `cd desktop && NO_STRIP=1 npx tauri build --bundles appimage,deb --config src-tauri/tauri.bundle.json` produces an AppImage/deb that launches without the repo or `uv` (sidecar proof, Linux equivalent of the Finder box). Plain `npm run tauri build` bundles no worker at all |
| 15 | Auth states | Claude signed out (a scratch `HOME` with no `.credentials.json`) → badge shows not signed in and jobs refuse with the provider's message ("Not logged in · Please run /login") |

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

### 2026-11-15 — v0.6.0 (Claude provider)

main `4188566` (PRs #140–#144 merged), package `0.6.0`. Private Xvfb `:91` (1600x1000) inside `dbus-run-session`, `GDK_BACKEND=x11`, `WAYLAND_DISPLAY`, `HYPRLAND_INSTANCE_SIGNATURE`, `CLAUDECODE` and every other `CLAUDE_*` variable unset. Claude Code provider (`claude` 2.1.325, mise install symlinked first on `PATH`, `MISE_TRUSTED_CONFIG_PATHS` set), model `claude-sonnet-5-5` for every job. Scratch HOME (only `.credentials.json` copied, mode 600), XDG and `GIT_CONFIG_GLOBAL` under `/home/flow/.local/state/flow/runs/r20261114-0580d2/scratch/live-run/` (`$S` below), libraries pre-seeded in `$S/xdg/config/com.arbor.app/settings.json`. Three libraries: `Main` (Tidewater, Glaciology, later Botany), `LibB` (a second Tidewater), `LibC` (Scratchclass, deleted for B3). Fixtures generated in `$S/fixtures` (multi-page PDFs with per-page marker tokens, a 28-page PDF, a text PPTX, an image-only PPTX, a DOCX, a scanned PDF). Pre-check last line: `{"type":"result","subtype":"success","is_error":false,"result":"ok",…}`. Real `~/.config/com.arbor.app/settings.json` stayed `87c2bcd705df9bebaa657bb89c3010e4cc90069b71f568af35a52d8883a2759b` before and after. No `hyprctl dispatch`, no input to the real outputs.

v0.6.0 Proof and the five fixes:

| # | Result | Evidence |
|---|--------|----------|
| A1 | Pass | `/` showed Today with Glaciology and Tidewater (and the LibB/LibC classes) (`$S/shots/00-launch.png`). |
| A2 | Pass | Pill menu → Update knowledge → Confirm. Pill read "Updating 1 of 1 · generate" (`05-updating.png`). Job `job-18e816baf586f59c` (claude, `prepare ok pdf_images`), commit `2d68a29 digest: Tidewater`. |
| A3 | Pass | Ticked Fiddler Crabs, Practice → Generate: job `job-18e816ef0082aeda` `{"digests":["Tidewater/digests/2026-11-15T0225.md"]}`, commit `135687f` (`study/flashcards.json` + `origins.json`); all 20 cards cite that digest. |
| A4 | Pass | Glaciology lecture with no cards: New in the class column (`21-glac.png`), Unread after a partial scroll (`22-partial.png`), "63% read" on Today (`23-today-partial.png`), no badge and gone from Continue reading after reading to the end (`24-end.png`, `25-today-read.png`). |
| A5 | Pass | settings.json sha256 identical (above). Real `~/.claude` has no project or JSON file mentioning this run; all CLI state went to the scratch HOMEs. |
| B1 | Pass | PDF through Claude with page images (`pdf_images`, A2 and job `job-18e816c68b745a33`); image-only PPTX → `pptx_images_fallback`, job `job-18e816e3115576b1`, commit `8be4657`, digest has `PPTXIMAGETOKEN`, 2,310 m, 4.1 m. |
| B2 | Pass | Main Tidewater, then LibB Tidewater (`?root=…/LibB`, `29-hash-B-crop.png`). Back → active `Main`, `?root=…/Main` (`31-back.png`); exam 2026-12-05 → `Main/.arbor/courses.json`, commit `bc4a77a`, LibB untouched. Forward → active `LibB`, `?root=…/LibB` (`39-forward.png`); exam 2026-12-19 → LibB only, commit `a5495ad`. |
| B3 | Pass | `rm -rf roots/LibC`, typed "salt"/"Kessel": palette shows "Couldn't search LibC" plus the other libraries' hits (`48-b3-search.png`, `49-fts.png`); `roots/LibC` was not recreated. |
| B4 | Pass | Scoped Generate (A3), graded fc_bb62b082 Mastered, fc_4005ee87 Wrong, fc_949efdb7 Again, then whole-class Refresh from digests: job `job-18e816fb158d0cfc`, commit `ccc974b`. All 20 scoped ids kept, 0 new Fiddler cards (41 = 20 + 15 + 6), origins all `full`, `progress.json` byte-identical. |
| B5 | Pass | Symlink `Main/Linkedclass → LibB/Tidewater`: on neither Today nor the sidebar (`00-launch.png`, `46-b5-today.png`); 10 clicks on every Today entry, none showed "Class not found" (`47-b5-click1..10.png`, OCR). |

Runbook rows (v3, v4) through Claude:

| # | Result | Evidence |
|---|--------|----------|
| 1 | Pass, DOCX/PPTX caveat | Job `job-18e816c68b745a33` (PDF ×3 `pdf_images`, DOCX `docx_text`, PPTX `pptx_text`), commit `b3548f1 digest: Glaciology, Tidewater`. Text PPTX digest omitted the slide marker tokens but kept every fact (model omission). |
| 2 | Pass | `glacier-long.pdf` chunks 1–25 and 26–28 then synthesis; digest states H26 182 m/yr, H28 196 m/yr. Notes scrolled to the end (`24-end.png`). |
| 3 | Fail (regression) | Main `course.md` rolls up four digests. LibB's one-digest index link `2026-11-15.md` does not open the digest: the click navigates the webview to Today (`62-course-link.png`, `63-after1.png`). Course notes on the new overview are `dangerouslySetInnerHTML` with no `data-arbor-digest` click handler. |
| 4 | Partial | Nested lists and inline code render, no closing `arbor-pages` text (`22-partial.png`, `24-end.png`). Claude wrote no table or emphasis, so those stay unproven. |
| 5 | Pass, caveat | FTS hit opened the Kessel digest (`50-fts-open.png`). Semantic needed Embed after Update (embed job `job-18e81789c7341fb2`); "beach hoppers shredding kelp" put the Wrack Lines digest second and it opened (`59-semantic.png`, `60-semantic-open.png`). The hashed n-gram embedder ranked a fiddler-crab chunk first. |
| 6 | Pass | Six files copied into class folders while the app ran showed up in review (`07-review6.png`). |
| 7 | Pass | Flip, Mastered/Wrong/Again persisted to `.arbor/users/live@arbor.test/Tidewater/progress.json` (`15-graded.png`). |
| 8 | Pass | Quiz job `job-18e81702ffc210ff`, commit `19ba6dc`; Submit showed `1 / 1 correct` (`20-quiz-submit.png`). |
| 9 | Pass | Concepts job `job-18e817b43047bbe4`, commit `6a5eac2`, 16 concepts; Read in digest opened Tidal Frame with concept chips (`65-graph.png`, `66-graph-nav.png`). |
| 10 | Fail (not a regression) | Diagrams job `job-18e817bd8c685f9a` succeeded with no figure (fixtures have none). Check citations `job-18e817c173528c6c`, commit `3135831`: 26 failures "claim not in digest", including honest cards such as fc_4005ee87 "They aerate the sediment." against "Fiddler crab burrows aerate marsh sediment." The matcher is unchanged since v3.0; Claude's terse backs miss it. |
| 11 | Pass | Reserved `study` shows the error (`70-crop.png`); `Botany` created in the active library (Main). |
| 12 | Pass | 9 `Notify` calls ("Arbor update finished", "succeeded") on the private bus (`$S/logs/notifications-1.log`). |
| 13 | Pass | Scanned PDF digest contains `OCRERRATICTOKEN` and the 140 km / 1,800 t facts. |
| 14 | Fail (not a regression), sidecar works | Deb built (`Arbor_0.6.0_amd64.deb`); AppImage fails in linuxdeploy (`Could not find dependency: libavif-8a7f9d56.so.16.4.2` from the PyInstaller onedir). The deb installs the worker at `usr/lib/Arbor/arbor-worker/`, which `sidecar_candidates` never checks, so the extracted app shows "worker project not found" (`103-deb.png`). With the onedir copied beside `desktop`, PATH = git/sh/bash/tesseract + `claude` only, cwd `/tmp`: Today loads and the worker process is the sidecar (`104-deb-sidecar.png`). |
| 15 | Pass, caveat | Scratch HOME without `.credentials.json`: pill "Claude · not signed in" (`96-signedout-pill.png`); Generate created no job and logged "Claude is not authenticated: {raw `claude auth status` JSON}" in the hidden log only (`100-signedout-log.png`). The CLI itself returns `Not logged in · Please run /login`. |
| T1 | Fail (regression) | Answer "about 1,800 tonnes … 140 kilometres [1][3][9]" with page chips; the chip opened the Kessel digest at Important Details (`76-T1-chip.png`). But the first message crashed the whole app: "date value is not finite in DateTimeFormat format()" (`73-T1.png`). `chat_threads.rs` writes `2026-11-15T02:44:14Z.858`; the new thread list formats it with `Intl`. Every later chat write (send, mode toggle) crashed again; the run continued by rewriting `index.json` to `….858Z` and reloading. |
| T2 | Pass, crash | "The sources do not say anything about tungsten…", banner "Not supported by this course" (`77-T2.png`). |
| T3 | Pass, crash | Explain stayed in the course with citations (`80-T3-explain.png`). v0.6 has no chat quiz mode; Quiz me on this wrote quiz `10a75ec study: Glaciology quiz from chat`. |
| T4 | Pass, crash | History survived a full restart (`84-T4-history.png`); New opened an empty chat; Delete all chats removed `chat/Glaciology` (`85-clear-dialog.png`, `86-cleared.png`). |
| T5 | Pass | After chatting, `git status` was only `?? .arbor/settings.json`; chat lives under the ignored `.arbor/users/*/chat/`. |
| T6 | Pass | Due today 40, weak topic Key Concepts after Wrong/Again grades, study plan commit `06fa9e7` (rendered only after leaving and reopening the overview), make card from selection saved `fc_f2ff9d46` with page `1-3`, commit `92d9565`. |
| T7 | Pass, caveat | Signed-out chat send showed "Claude is not authenticated: {…raw JSON…}" above the composer (`102-T7-send.png`). |
| C1–C6 | Not run, out of scope | No provider change since v0.5. |

Overall: **FAIL**. Every A and B box passed. Row 3 and the chat crash (T1–T4) are v0.6.0 regressions.

Notes:

- The update review follows a symlinked class folder: with `Main/Linkedclass → LibB/Tidewater`, Update knowledge listed `Linkedclass/libb-lecture.pdf` and would digest LibB's file into a class that Today and the sidebar hide (`02-review.png`). `courses.discover_sources` uses `is_dir()`, which follows links. The symlink was moved aside for A2's "1 of 1".
- The pill reads "Library up to date · 1794709451": `jobs.finished_at` is epoch seconds and `compactAgo` gets it raw.
- WebKitGTK date inputs under Xvfb: typed digits and Tab do not reach the field while the calendar popup is open or the docked inspector has focus. Close the inspector, pick the day in the popup, press Escape, then Enter to save.

### 2026-11-15 — v0.6.0 re-run (Claude provider)

Re-run of the boxes that failed above, on main `4b9ad28` (PR #145 pill time, #146 Course notes links, #147 chat timestamps), package `0.6.0`. Same setup as the first run: private Xvfb `:91` (1600x1000) inside `dbus-run-session`, `GDK_BACKEND=x11`, `WAYLAND_DISPLAY`, `HYPRLAND_INSTANCE_SIGNATURE`, `CLAUDECODE` and every other `CLAUDE_*` variable unset, `claude` 2.1.325 (mise install symlinked first on `PATH`, `MISE_TRUSTED_CONFIG_PATHS` set), model `claude-sonnet-5-5`. Fresh scratch HOME (only `.credentials.json`, mode 600), XDG, `GIT_CONFIG_GLOBAL` and Knowledge root `Main` under `/home/flow/.local/state/flow/runs/r20261114-0580d2/scratch/rerun/` (`$S` below), settings pre-seeded in `$S/xdg/config/com.arbor.app/settings.json`. Class `Tidewater` built in this run from the first run's fixtures `tide-lecture1.pdf` and `tide-lecture2.pdf` (3 pages each) through Update knowledge. Before launch, `.arbor/users/live@arbor.test/chat/Tidewater/index.json` was seeded with one thread `t-20261110T090000Z-a1b2c3` stamped `2026-11-10T09:00:00Z.123` (plus its `.jsonl`). Nothing under the root was edited after launch. Pre-check last line: `{"type":"result","subtype":"success","is_error":false,"result":"ok",…}`. Real `~/.config/com.arbor.app/settings.json` stayed `87c2bcd705df9bebaa657bb89c3010e4cc90069b71f568af35a52d8883a2759b` before and after. No `hyprctl dispatch`, no input to the real outputs.

| # | Result | Evidence |
|---|--------|----------|
| R3 (row 3) | Pass | One digest: job `job-18e81c43fcad3fe3` (`provider: claude`, `prepare ok pdf_images`), commit `027c721 digest: Tidewater`, `course.md` = `See [2026-11-15.md](digests/2026-11-15.md).` + Overview. Overview → Course notes (`04-class.png`) → click `2026-11-15.md` opened that digest in Read, "Tidewater Ecology: Tides, Zonation, Sediment" (`05-R3-one-link.png`), not Today. Two digests: job `job-18e81c4ed6202546`, commit `4270370` added `digests/2026-11-15T0406.md`, and `course.md` became a synthesized roll-up covering both lectures (`11-overview2.png`). The synthesized roll-up has no digest links by design: `course_synthesis.py` writes the `See [...]` index only for one digest and a per-digest link list (`build_course_toc`) only when synthesis fails. Each digest opens from the lecture list (`12-digest2.png`). |
| T1 | Pass | New chat, "What burrow density do fiddler crabs reach in the Corvel low marsh?" → "…reaches 140 per square metre [1][2]." with chips `Course overview · tidewater` and `Fiddler Crabs in Tidewater Ecology · important-details · p. 1-3` (`T1-poll-12.png`). The page chip opened Read on that digest at Important Details (`16-T1-chip.png`). No "Something went wrong" in any of the 13 T1 frames, nor in any later frame (tesseract on every screenshot). |
| T2 | Pass | "What is the average water salinity of the Corvel estuary…?" → "The sources do not give the average water salinity…", banner "Not supported by this course" (`T2-poll-12.png`). |
| T3 | Pass | Mode chip → Explain (a chat write; thread row turned "Explain · now", no crash, `18-mode.png`). "Explain step by step why the Corvel marsh is keeping pace with sea level rise." → five steps from 4.2 vs 3.1 mm/yr, and says the sources do not link crab burrowing to accretion (`T3-poll-16.png`). v0.6 has no chat quiz mode. "Quiz me on this" is disabled on answers that cite only `course.md` ("Needs a lecture…"); on the T1 answer it ran job `job-18e81ca2010b9109` and committed `2cee414 study: Tidewater quiz from chat` (`study/quiz.json`, `origins.json`). |
| T4 | Pass | Killed `desktop` by PID; `tauri dev` and Vite exited; relaunched. The thread list showed "Explain · 3 min ago" and "Seeded old-stamp thread · Ask · Tue", and the transcript was intact (`25-T4-history.png`). The seeded thread opened (`27-hover-seeded.png`). New → send created a third thread "Ask · now" with a cited answer (`T4-new-poll-10.png`). Row menu → Delete → confirm removed the seeded thread from `index.json` and deleted its `.jsonl` (`29-menu.png`, `30-delete-dialog.png`, `31-deleted.png`). Final `index.json`: `2026-11-15T04:07:30.797Z`, `2026-11-15T04:10:22.476Z`, `2026-11-15T04:13:27.562Z`, `2026-11-15T04:13:29.655Z`. All parse as RFC 3339; `grep -c 'Z\.'` = 0. |
| Heal | Pass | Seeded `2026-11-10T09:00:00Z.123` listed as "Ask · Tue" (2026-11-10 is a Tuesday) under This week and opened (`13-ask.png`). On disk it stayed `Z.123` until the first write: the T1 send rewrote it to `"created_at":"2026-11-10T09:00:00.123Z","updated_at":"2026-11-10T09:00:00.123Z"`. |
| P | Pass | Pill "Library up to date · just now" right after each job (`03-updating.png`), then "· 1m ago" (`T1-poll-12.png`), "· 3m ago" (`T2-poll-12.png`), "· 4m ago", "· 5m ago" (`21-top.png`), and "· 2m ago" after the restart. Never a raw number; `jobs.finished_at` is still epoch seconds (`1794715537`). |
| S | Pass | Settings sha256 above, mtime unchanged (2026-10-17). Real `~/.claude/projects` has no directory or transcript for the scratch root; all CLI state went to the scratch HOME. |

Overall: **PASS**. Row 3 and T1–T4 pass with no hand edits after launch, and both regressions from the first run are fixed.

Notes:

- Follow-up answers re-cite only this turn's sources. The T2 answer stored "my earlier answer cited , but only source [1] was provided": the model saw its T1 answer's `[2]` with one source this turn, and the app stripped the unknown `[2]`. The text reads oddly but nothing is wrong.
- `$S/shots/` holds every screenshot named above.

## Folder picker under Xvfb

Issue #70, checked 2026-10-30 on a v0.5.31 debug build (`cd desktop && npm run tauri build -- --debug --no-bundle`) on private Xvfb displays with `dbus-run-session`, `GDK_BACKEND=x11`, `WAYLAND_DISPLAY` unset, and scratch `HOME` and XDG dirs. No window manager. The real `~/.config/com.arbor.app/settings.json` was not touched.

**Cause.** Every folder picker called the dialog without a start folder, so GTK 3.24 opened it on Recent. In `SELECT_FOLDER` mode on Recent, Open stays disabled, and a path typed after Ctrl+L never enables it. Return only activates that disabled button. That is the v3 and v5 "never accepts Open" result (C4's export picker too), and a person who presses Ctrl+L and Enter from Recent hits it as well. Window focus made no difference. A minimal rfd program with `set_directory` accepted a typed path, which is what pointed at the start folder.

**Fix.** `openDialog` in `desktop/src/lib/ipc.ts` now starts every folder picker in the home folder when the caller gives no `defaultPath`. On the fixed build the dialog opens on Home with Open enabled. Ctrl+L, typing `/tmp/zz70audit/leaf`, and Return saved that folder as the Knowledge root and ran `git init` in it.

Driver notes for live runs:

- Type paths slowly (`xdotool type --delay 150`). At a 40 ms delay, GTK's inline completion can duplicate a path component when sibling names share a prefix.
- Clicking a folder row and then Open also works, and does not depend on the location entry.

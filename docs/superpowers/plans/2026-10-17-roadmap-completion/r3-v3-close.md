# Release 3 — `v3.0.0`: close Version 3

Branch: `release/v3.0.0`. No new features.

1. Run the Version 3 script in [linux-live-run.md](linux-live-run.md) against `v2.5.0` with Grok.
2. File each failure as a row in the checklist *Blockers* table and a GitHub issue; fix on short `fix/…` branches (patch releases `v2.5.x` if useful). Re-run only the failed boxes.
3. Box 14 (packaged Linux build) is new: if the sidecar is not found from the AppImage, fix the path lookup in `worker.rs` the same way the DMG sidecar works.
4. Docs: checklist Version 3 rows → `Live run [x]`; the four 2026-09-20 blockers → `[x]` from the live run; `PROJECT.md` version table marks `v3.0.0` shipped and Version 4 in progress; `CHANGELOG.md` `3.0.0` section.
5. Bump to `3.0.0`, merge, tag **`v3.0.0`**.
6. Close #3, #4, #19, #21, #30, #42, #57 with a comment linking the run section.

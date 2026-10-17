# Release 1 — `v2.4.0`: brand mark + gate policy

Branch: `feat/brand-mark`.

## Assets

Source files (already in the repo, uncommitted):

- `docs/brand/arbor-logo-wordmark.png` — original 1254² logo with the "Arbor" wordmark.
- `docs/brand/arbor-mark-raster.png` — Grok 4.7 `image_edit` output: same tree, wordmark removed, re-centered on the off-white square.

Derived files to generate (script: `scripts/brand-assets.sh`, ImageMagick 7 — `magick` is installed here):

| Output | How | Used by |
|--------|-----|---------|
| `docs/brand/arbor-mark.png` (1024², transparent) | `magick arbor-mark-raster.png -fuzz 6% -transparent "#f8f8f4"`-style key on the sampled background colour, `-trim`, pad to square with ~8% margin, resize 1024 | master for everything below |
| `desktop/src-tauri/icons/*` | `cd desktop && npx tauri icon ../docs/brand/arbor-mark.png` (regenerates every size + `icon.icns` + `icon.ico`) | window/taskbar/dock icon, DMG |
| `desktop/src/assets/arbor-mark.png` (128² transparent) | resize from master | sidebar brand, welcome screen |
| `desktop/public/favicon.png` (64²) | resize from master | `<link rel="icon">` in `index.html` |
| `docs/brand/arbor-mark-dark.png` | master with the trunk lightened (`#4a3b2f` → cream) via `-fill … -opaque … -fuzz` | dark theme, if the brown trunk is unreadable on the dark sidebar |

Sample the background colour with `magick arbor-mark-raster.png -format '%[pixel:p{5,5}]' info:` rather than guessing; the edge of the antialiased strokes needs `-fuzz` tuned by eye at 100% and 25% zoom.

If the raster mark looks soft at 16–32 px, ask Grok again for a simplified small-size variant (fewer canopy rings) rather than hand-editing.

## Code changes

- `desktop/index.html`: replace `<div class="brand-mark">A</div>` with `<img class="brand-mark" src="/src/assets/arbor-mark.png" alt="" />`; add favicon link; add the mark above "Welcome to Arbor".
- `desktop/src/styles.css` `.brand-mark`: drop the sage background, border-radius, and text styles; keep 28×28, `object-fit: contain`. Dark theme swaps to the dark variant via `[data-theme="dark"] .brand-mark { content: url(...) }` only if the trunk fails contrast.
- Remove unused `src/assets/tauri.svg`, `vite.svg`, `typescript.svg` if nothing imports them (`grep -r` first).
- `README.md`: put the wordmark logo at the top.
- `desktop/tests`: one test asserting the sidebar brand is an `<img>` with the asset path (matches the existing DOM-structure tests).

## Gate policy rewrite (docs only, same PR)

- `PROJECT.md` → *Test gates*: replace the Mac-batch paragraph with: a version closes when its rows are implemented, locally tested, and one **Linux live run** is recorded in [linux-live-run.md](linux-live-run.md). Mac batches are optional and never block a tag.
- `PROJECT.md` version table and Version 3/4/5 "start only after" sentences: reword to the Linux gate.
- `docs/implementation-checklist.md`: rename the `Mac batch` column to `Live run`, add a `Mac (optional)` column, carry existing Mac `[x]` marks into it, rewrite the *Gates* table.

## Done when

- `npm run tauri dev` on this machine shows the tree in the sidebar, window icon, and taskbar.
- Light and dark themes both legible.
- Local command set green. Tag `v2.4.0`.

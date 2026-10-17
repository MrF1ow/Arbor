#!/usr/bin/env bash
# Generate Arbor brand PNG assets from docs/brand/arbor-mark-raster.png (ImageMagick 7).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAGICK="${MAGICK:-/usr/bin/magick}"

SRC="${ROOT}/docs/brand/arbor-mark-raster.png"
MASTER="${ROOT}/docs/brand/arbor-mark.png"
MASTER_DARK="${ROOT}/docs/brand/arbor-mark-dark.png"
PREVIEW_DIR="/tmp/arbor-brand-preview"

sample_background_hex() {
  "$MAGICK" "$SRC" -format '#%[hex:u.p{5,5}]' info:
}

# Soft alpha from RGB distance to sampled bg; partial edges use flat green/brown cores (no unmix).
decontaminate_to_png() {
  local out_png="$1"
  SRC="$SRC" OUT_PNG="$out_png" python3 - <<'PY'
import math
import os
import sys

from PIL import Image

src = os.environ["SRC"]
out_png = os.environ["OUT_PNG"]

T0, T1 = 18.0, 48.0
span = T1 - T0

GREEN = (84, 105, 52)
BROWN = (66, 56, 47)


def rgb_dist(a, b):
    dr, dg, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    return math.sqrt(dr * dr + dg * dg + db * db)


img = Image.open(src).convert("RGBA")
w, h = img.size
px_in = img.load()
bg = px_in[5, 5][:3]

print(
    f"sampled_bg=srgb({bg[0]},{bg[1]},{bg[2]}) alpha_thresholds=({int(T0)},{int(T1)})",
    file=sys.stderr,
)

out = Image.new("RGBA", (w, h))
px_out = out.load()

for y in range(h):
    for x in range(w):
        r, g, b, _ = px_in[x, y]
        rgb = (r, g, b)
        dr, dg, db = r - bg[0], g - bg[1], b - bg[2]
        dist = math.sqrt(dr * dr + dg * dg + db * db)
        al = (dist - T0) / span
        if al <= 0.0:
            px_out[x, y] = (0, 0, 0, 0)
            continue
        if al >= 1.0:
            px_out[x, y] = (r, g, b, 255)
            continue
        core = GREEN if rgb_dist(rgb, GREEN) <= rgb_dist(rgb, BROWN) else BROWN
        a8 = int(round(al * 255.0))
        px_out[x, y] = (*core, a8)

out.save(out_png, "PNG")
PY
}

# Lanczos leaves non-zero RGB at alpha 0 and blends edge cores; restore flat cores on partial alpha.
repair_master_rgba() {
  local png="$1"
  PNG="$png" python3 - <<'PY'
import math
import os

from PIL import Image

png = os.environ["PNG"]
GREEN = (84, 105, 52)
BROWN = (66, 56, 47)


def rgb_dist(a, b):
    dr, dg, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    return math.sqrt(dr * dr + dg * dg + db * db)


img = Image.open(png).convert("RGBA")
w, h = img.size
px = img.load()
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if a == 0:
            px[x, y] = (0, 0, 0, 0)
            continue
        if a < 255:
            rgb = (r, g, b)
            core = GREEN if rgb_dist(rgb, GREEN) <= rgb_dist(rgb, BROWN) else BROWN
            px[x, y] = (*core, a)

img.save(png, "PNG")
PY
}

build_master() {
  local keyed
  keyed="$(mktemp --tmpdir arbor-mark-keyed.XXXXXX.png)"
  decontaminate_to_png "$keyed"
  "$MAGICK" "$keyed" -alpha on -background none -trim +repage \
    -background none -gravity center \
    -extent '%[fx:max(w,h)/0.84]x%[fx:max(w,h)/0.84]' \
    -filter Lanczos -resize 1024x1024 \
    -define png:exclude-chunk=bKGD \
    "$MASTER"
  repair_master_rgba "$MASTER"
  rm -f "$keyed"
}

build_previews() {
  mkdir -p "$PREVIEW_DIR"
  "$MAGICK" "$MASTER" -background none -resize 256x256 \
    "${PREVIEW_DIR}/mark-256.png"
  "$MAGICK" -size 256x256 "xc:#F3EDE3" \
    \( "$MASTER" -background none -resize 256x256 \) -gravity center -composite \
    "${PREVIEW_DIR}/on-light.png"
  "$MAGICK" -size 256x256 "xc:#252922" \
    \( "$MASTER" -background none -resize 256x256 \) -gravity center -composite \
    "${PREVIEW_DIR}/on-dark.png"
  "$MAGICK" -size 256x256 "xc:#252922" \
    \( "$MASTER_DARK" -background none -resize 256x256 \) -gravity center -composite \
    "${PREVIEW_DIR}/dark-on-dark.png"
}

# --- Later release units (not invoked by default) ---

build_desktop_icons() {
  (cd "${ROOT}/desktop" && npx tauri icon "../docs/brand/arbor-mark.png")
}

build_sidebar_asset() {
  mkdir -p "${ROOT}/desktop/src/assets"
  "$MAGICK" "$MASTER" -background none -filter Lanczos -resize 128x128 \
    "${ROOT}/desktop/src/assets/arbor-mark.png"
}

build_sidebar_dark_asset() {
  mkdir -p "${ROOT}/desktop/src/assets"
  "$MAGICK" "$MASTER_DARK" -background none -filter Lanczos -resize 128x128 \
    "${ROOT}/desktop/src/assets/arbor-mark-dark.png"
}

build_favicon() {
  mkdir -p "${ROOT}/desktop/public"
  "$MAGICK" "$MASTER" -background none -filter Lanczos -resize 64x64 \
    "${ROOT}/desktop/public/favicon.png"
}

# Brown trunk pixels → cream (#F3EDE3); green rings unchanged (distance to core RGB).
build_dark_variant() {
  MASTER="$MASTER" MASTER_DARK="$MASTER_DARK" python3 - <<'PY'
import math
import os
import shutil

from PIL import Image

master = os.environ["MASTER"]
master_dark = os.environ["MASTER_DARK"]

GREEN = (84, 105, 52)
BROWN = (66, 56, 47)
CREAM = (243, 237, 227)


def rgb_dist(a, b):
    dr, dg, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    return math.sqrt(dr * dr + dg * dg + db * db)


shutil.copyfile(master, master_dark)
img = Image.open(master_dark).convert("RGBA")
w, h = img.size
px = img.load()
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if a == 0:
            continue
        rgb = (r, g, b)
        if rgb_dist(rgb, BROWN) < rgb_dist(rgb, GREEN):
            px[x, y] = (*CREAM, a)

img.save(master_dark, "PNG")
PY
}

main() {
  build_master
  build_dark_variant
  build_sidebar_asset
  build_sidebar_dark_asset
  build_favicon
  build_previews
  build_desktop_icons
}

main "$@"

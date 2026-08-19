#!/usr/bin/env bash
# Build a PyInstaller onefile arbor-worker sidecar for Tauri externalBin.
# Codex CLI is not bundled. The packaged app still expects `codex` on PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON_DIR="$ROOT/python"
OUT_DIR="$ROOT/desktop/src-tauri/binaries"

if [[ -z "${TARGET_TRIPLE:-}" ]]; then
  if ! command -v rustc >/dev/null 2>&1; then
    echo "rustc is required to name the sidecar (or set TARGET_TRIPLE)" >&2
    exit 1
  fi
  TARGET_TRIPLE="$(rustc -vV | awk '/^host:/{print $2}')"
fi

mkdir -p "$OUT_DIR"
cd "$PYTHON_DIR"
uv sync
uv run --with pyinstaller pyinstaller \
  --noconfirm \
  --clean \
  --onefile \
  --name arbor-worker \
  --paths src \
  --collect-submodules arbor_worker \
  --collect-all pymupdf \
  --hidden-import fitz \
  --hidden-import pptx \
  src/arbor_worker/__main__.py

DEST="$OUT_DIR/arbor-worker-$TARGET_TRIPLE"
mv "$PYTHON_DIR/dist/arbor-worker" "$DEST"
chmod +x "$DEST"
echo "wrote $DEST"

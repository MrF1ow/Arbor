#!/usr/bin/env bash
# Build a PyInstaller arbor-worker sidecar for Tauri (onedir by default; onefile fallback).
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

PYINSTALLER_COMMON=(
  --noconfirm
  --clean
  --name arbor-worker
  --paths src
  --collect-submodules arbor_worker
  --collect-all pymupdf
  --hidden-import fitz
  --hidden-import pptx
  src/arbor_worker/__main__.py
)

remove_stale_onefile_sidecars() {
  for old in "$OUT_DIR"/arbor-worker-*; do
    if [[ -f "$old" ]]; then
      rm -f "$old"
    fi
  done
}

sign_mach_o_in_dir() {
  local dir="$1"
  local f
  find "$dir" -type f 2>/dev/null | while IFS= read -r f; do
    if file "$f" 2>/dev/null | grep -q 'Mach-O'; then
      codesign --force --sign - "$f"
    fi
  done
  if [[ -f "$dir/arbor-worker" ]]; then
    codesign --force --sign - "$dir/arbor-worker"
  fi
}

if [[ "${ARBOR_WORKER_ONEFILE:-}" == "1" ]]; then
  uv run --with pyinstaller pyinstaller \
    --onefile \
    "${PYINSTALLER_COMMON[@]}"
  DEST="$OUT_DIR/arbor-worker-$TARGET_TRIPLE"
  mv "$PYTHON_DIR/dist/arbor-worker" "$DEST"
  chmod +x "$DEST"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    codesign --force --sign - "$DEST"
  fi
  echo "wrote $DEST (onefile fallback)"
  exit 0
fi

remove_stale_onefile_sidecars

uv run --with pyinstaller pyinstaller \
  --onedir \
  "${PYINSTALLER_COMMON[@]}"

DEST_DIR="$OUT_DIR/arbor-worker-dir"
rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR"
mv "$PYTHON_DIR/dist/arbor-worker/"* "$DEST_DIR/"
chmod +x "$DEST_DIR/arbor-worker"

if [[ "$(uname -s)" == "Darwin" ]]; then
  sign_mach_o_in_dir "$DEST_DIR"
fi

echo "wrote $DEST_DIR/ (onedir)"

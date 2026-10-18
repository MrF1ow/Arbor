#!/usr/bin/env bash
# Smoke-test a signed macOS .app or .dmg before publish (issue #95).
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <path-to-.app-or-.dmg>" >&2
  exit 2
fi

INPUT="$1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_VERSION="$(
  python3 -c "import json; print(json.load(open('$REPO_ROOT/desktop/src-tauri/tauri.conf.json'))['version'])"
)"

cleanup_mount() {
  # The mount table shows /private/var for $TMPDIR, so detach without matching it.
  if [[ -n "${MOUNT_POINT:-}" ]]; then
    hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null ||
      hdiutil detach "$MOUNT_POINT" -force -quiet 2>/dev/null || true
  fi
}

MOUNT_POINT=""
APP_PATH=""

if [[ "$INPUT" == *.dmg ]]; then
  MOUNT_POINT="$(mktemp -d "${TMPDIR:-/tmp}/arbor-dmg.XXXXXX")"
  trap cleanup_mount EXIT
  hdiutil attach -nobrowse -readonly "$INPUT" -mountpoint "$MOUNT_POINT" >/dev/null
  # macOS find is BSD and has no -quit. A one-level glob is bash 3.2-safe.
  APP_PATH=""
  for candidate in "$MOUNT_POINT"/*.app; do
    if [[ -d "$candidate" ]]; then
      APP_PATH="$candidate"
      break
    fi
  done
  if [[ -z "$APP_PATH" ]]; then
    echo "no .app found in DMG mount" >&2
    exit 1
  fi
elif [[ "$INPUT" == *.app ]]; then
  APP_PATH="$INPUT"
else
  echo "expected .app or .dmg path" >&2
  exit 2
fi

WORKER="$APP_PATH/Contents/MacOS/arbor-worker"
if [[ ! -f "$WORKER" ]]; then
  echo "missing worker binary: $WORKER" >&2
  exit 1
fi

SIGNING_OUT="$(codesign -dv --verbose=4 "$WORKER" 2>&1)" || true
# codesign -dv writes to stderr. The runtime bit is inside the flags list,
# for example flags=0x10002(adhoc,runtime), not a whitespace-delimited word.
if printf '%s\n' "$SIGNING_OUT" | grep -E 'flags=0x[0-9a-fA-F]+\([^)]*runtime' >/dev/null; then
  echo "hardened runtime must be disabled for ad-hoc PyInstaller worker (found runtime flag)" >&2
  echo "$SIGNING_OUT" >&2
  exit 1
fi

run_with_timeout() {
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$@"
  elif command -v timeout >/dev/null 2>&1; then
    timeout "$@"
  else
    "${@:2}"
  fi
}

VERSION_OUT="$(run_with_timeout 60 "$WORKER" --version)" || {
  echo "arbor-worker --version failed" >&2
  echo "$VERSION_OUT" >&2
  exit 1
}
VERSION_OUT="$(printf '%s' "$VERSION_OUT" | tr -d '[:space:]')"
if [[ "$VERSION_OUT" != "$EXPECTED_VERSION" ]]; then
  echo "expected version $EXPECTED_VERSION in --version output, got: $VERSION_OUT" >&2
  exit 1
fi

# The worker prints JSON on stdout. Stderr may carry warnings, so keep it out.
LIST_OUT="$(run_with_timeout 120 "$WORKER" list-providers)" || {
  echo "arbor-worker list-providers failed" >&2
  echo "$LIST_OUT" >&2
  exit 1
}
LIST_JSON="$(printf '%s\n' "$LIST_OUT" | awk 'NF { last = $0 } END { print last }')"
python3 -c 'import json,sys; json.loads(sys.argv[1])' "$LIST_JSON" || {
  echo "arbor-worker list-providers did not print JSON: $LIST_OUT" >&2
  exit 1
}

echo "smoke ok: worker $EXPECTED_VERSION, signing without hardened runtime"

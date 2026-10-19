#!/usr/bin/env bash
# Smoke-test a signed macOS .app or .dmg before publish (issue #95, #97).
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

WORKER="$APP_PATH/Contents/Resources/arbor-worker/arbor-worker"
WORKER_DIR="$APP_PATH/Contents/Resources/arbor-worker"
if [[ ! -f "$WORKER" ]]; then
  WORKER="$APP_PATH/Contents/MacOS/arbor-worker"
  WORKER_DIR="$(dirname "$WORKER")"
fi
if [[ ! -f "$WORKER" ]]; then
  echo "missing worker binary (checked Resources and MacOS paths)" >&2
  exit 1
fi

check_no_hardened_runtime() {
  local target="$1"
  local signing_out
  signing_out="$(codesign -dv --verbose=4 "$target" 2>&1)" || true
  if printf '%s\n' "$signing_out" | grep -E 'flags=0x[0-9a-fA-F]+\([^)]*runtime' >/dev/null; then
    echo "hardened runtime must be disabled for ad-hoc PyInstaller worker (found runtime flag on $target)" >&2
    echo "$signing_out" >&2
    exit 1
  fi
}

check_no_hardened_runtime "$WORKER"
if [[ -d "$WORKER_DIR" ]]; then
  while IFS= read -r f; do
    if [[ -n "$f" ]] && file "$f" 2>/dev/null | grep -q 'Mach-O'; then
      check_no_hardened_runtime "$f"
    fi
  done < <(find "$WORKER_DIR" -type f 2>/dev/null)
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

# Performance gate: 1 warm-up, then 5 timed --version runs (median must be ≤ 1500 ms).
run_with_timeout 60 "$WORKER" --version >/dev/null || {
  echo "arbor-worker --version warm-up failed" >&2
  exit 1
}
PERF_RESULT="$(python3 - "$WORKER" <<'PY'
import subprocess
import sys
import time

worker = sys.argv[1]
times_ms = []
for i in range(5):
    start = time.perf_counter()
    subprocess.run([worker, "--version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    ms = (time.perf_counter() - start) * 1000.0
    times_ms.append(ms)
    print(f"perf --version run {i + 1}: {ms:.1f} ms", flush=True)

times_ms.sort()
median = times_ms[len(times_ms) // 2]
print(f"perf --version median: {median:.1f} ms", flush=True)
if median > 1500.0:
    print(f"perf gate failed: median {median:.1f} ms > 1500 ms", file=sys.stderr)
    sys.exit(1)
PY
)" || {
  echo "$PERF_RESULT" >&2
  exit 1
}
printf '%s\n' "$PERF_RESULT"

if ! run_with_timeout 120 python3 - "$WORKER" <<'PY'
import json
import os
import select
import subprocess
import sys
import tempfile

worker = sys.argv[1]
deadline_secs = 20.0

tmpdir = tempfile.mkdtemp(prefix="arbor-serve-smoke-")
root = os.path.join(tmpdir, "lib")
os.mkdir(root)
subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
subprocess.run(
    ["git", "config", "user.email", "smoke@test"],
    cwd=root,
    check=True,
    capture_output=True,
)
subprocess.run(
    ["git", "config", "user.name", "smoke"],
    cwd=root,
    check=True,
    capture_output=True,
)
subprocess.run(
    ["git", "commit", "--allow-empty", "-m", "init"],
    cwd=root,
    check=True,
    capture_output=True,
)

proc = subprocess.Popen(
    [worker, "serve"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    text=True,
)
assert proc.stdin and proc.stdout

req1 = json.dumps({"id": 1, "argv": ["library-show", "--root", root], "env": {}})
req2 = json.dumps({"id": 2, "argv": ["library-show", "--root", root], "env": {}})
proc.stdin.write(req1 + "\n" + req2 + "\n")
proc.stdin.flush()

ids = set()
import time

start = time.monotonic()
buf = ""
while len(ids) < 2 and (time.monotonic() - start) < deadline_secs:
    while "\n" in buf:
        line, _, buf = buf.partition("\n")
        if not line.strip():
            continue
        resp = json.loads(line)
        ids.add(resp["id"])
        assert resp["exit"] == 0
        if "present" not in resp.get("stdout", ""):
            raise SystemExit("library-show stdout missing present")
    remaining = deadline_secs - (time.monotonic() - start)
    if remaining <= 0:
        break
    ready, _, _ = select.select([proc.stdout], [], [], min(remaining, 1.0))
    if ready:
        chunk = os.read(proc.stdout.fileno(), 65536)
        if not chunk:
            break
        buf += chunk.decode("utf-8")

if ids != {1, 2}:
    raise SystemExit(f"expected response ids {{1, 2}}, got {ids!r}")

proc.stdin.close()
try:
    proc.wait(timeout=int(deadline_secs))
except subprocess.TimeoutExpired:
    proc.kill()
    proc.wait(timeout=5)

print("serve round trip ok", flush=True)
PY
then
  echo "arbor-worker serve round trip failed" >&2
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

echo "smoke ok: worker $EXPECTED_VERSION, signing without hardened runtime, perf gate passed"

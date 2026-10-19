#!/usr/bin/env bash
# Benchmark arbor-worker subcommands against a temp git library.
# Usage: bench-worker.sh [--serve] <worker-command...>
# Example: bench-worker.sh uv run --project python arbor-worker
#          bench-worker.sh --serve uv run --project python arbor-worker
set -euo pipefail

SERVE=0
if [[ $# -ge 1 && $1 == "--serve" ]]; then
  SERVE=1
  shift
fi

if [[ $# -lt 1 ]]; then
  echo "usage: bench-worker.sh [--serve] <worker-command...>" >&2
  exit 64
fi

WORKER=("$@")
RUNS="${RUNS:-10}"
SERVE_RUNS="${SERVE_RUNS:-30}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

LIB="$TMP/lib"
mkdir -p "$LIB/bench"
git -C "$LIB" init -q
git -C "$LIB" config user.email "bench@arbor.local"
git -C "$LIB" config user.name "bench"
git -C "$LIB" commit --allow-empty -q -m "init"

run_timed() {
  local name="$1"
  shift
  python3 - "$name" "$RUNS" "$@" <<'PY'
import json
import subprocess
import sys
import time

name, runs_s, *cmd = sys.argv[1:]
runs = int(runs_s)
times_ms = []
for _ in range(runs):
    start = time.perf_counter()
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    times_ms.append((time.perf_counter() - start) * 1000.0)

times_ms.sort()
n = len(times_ms)

def pct(p: float) -> float:
    if n == 1:
        return times_ms[0]
    idx = min(n - 1, int(round(p * (n - 1))))
    return times_ms[idx]

print(
    f"{name} {times_ms[0]:.1f} {pct(0.5):.1f} {pct(0.9):.1f} {times_ms[-1]:.1f}",
    flush=True,
)
PY
}

if [[ "$SERVE" -eq 1 ]]; then
  python3 - "$LIB" "$SERVE_RUNS" "${WORKER[@]}" <<'PY'
import json
import subprocess
import sys
import time

lib, runs_s, *worker = sys.argv[1:]
runs = int(runs_s)
proc = subprocess.Popen(
    [*worker, "serve"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    text=True,
)
assert proc.stdin and proc.stdout
# Warm the interpreter and imports inside the persistent process.
warm = {
    "id": 0,
    "argv": ["library-show", "--root", lib],
    "env": {},
}
proc.stdin.write(json.dumps(warm) + "\n")
proc.stdin.flush()
proc.stdout.readline()

times_ms = []
for i in range(1, runs + 1):
    req = {
        "id": i,
        "argv": ["library-show", "--root", lib],
        "env": {},
    }
    start = time.perf_counter()
    proc.stdin.write(json.dumps(req) + "\n")
    proc.stdin.flush()
    proc.stdout.readline()
    times_ms.append((time.perf_counter() - start) * 1000.0)

proc.stdin.close()
proc.wait(timeout=30)

times_ms.sort()
n = len(times_ms)

def pct(p: float) -> float:
    if n == 1:
        return times_ms[0]
    idx = min(n - 1, int(round(p * (n - 1))))
    return times_ms[idx]

print(
    f"serve-library-show-warm {times_ms[0]:.1f} {pct(0.5):.1f} {pct(0.9):.1f} {times_ms[-1]:.1f}",
    flush=True,
)
PY
  exit 0
fi

run_timed version "${WORKER[@]}" --version
run_timed library-show "${WORKER[@]}" library-show --root "$LIB"
run_timed sync-show "${WORKER[@]}" sync --root "$LIB" --show
run_timed study-progress-due "${WORKER[@]}" study-progress --root "$LIB" --course bench due

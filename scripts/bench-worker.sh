#!/usr/bin/env bash
# Benchmark arbor-worker subcommands against a temp git library.
# Usage: bench-worker.sh <worker-command...>
# Example: bench-worker.sh uv run --project python arbor-worker
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: bench-worker.sh <worker-command...>" >&2
  exit 64
fi

WORKER=("$@")
RUNS="${RUNS:-10}"

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

run_timed version "${WORKER[@]}" --version
run_timed library-show "${WORKER[@]}" library-show --root "$LIB"
run_timed sync-show "${WORKER[@]}" sync --root "$LIB" --show
run_timed study-progress-due "${WORKER[@]}" study-progress --root "$LIB" --course bench due

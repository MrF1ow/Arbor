"""Stop a running provider call when the caller's `cancel_check` turns true.

CLI providers run their process on a worker thread while this module polls; HTTP
providers run the blocking POST on a daemon thread. Either way the caller gets a
ProviderCancelled within about KILL_AFTER + POLL_INTERVAL seconds.
"""

from __future__ import annotations

import subprocess
import threading
from collections.abc import Callable
from typing import Any, TypeVar

from arbor_worker.provider.errors import ProviderCancelled

POLL_INTERVAL = 0.5
KILL_AFTER = 2.0

T = TypeVar("T")


def stop_process(proc: Any, done: Callable[[float], bool]) -> None:
    """terminate(), then kill() if `done(KILL_AFTER)` says it is still running.

    `done(timeout)` waits up to `timeout` seconds and returns whether the process
    (or whatever depends on it) has finished.
    """
    try:
        proc.terminate()
    except OSError:
        pass
    if done(KILL_AFTER):
        return
    try:
        proc.kill()
    except OSError:
        pass


def run_cli_cancellable(
    popen: Callable[..., Any],
    argv: list[str],
    *,
    input: str | None,
    cwd,
    env: dict[str, str],
    cancel_check: Callable[[], bool],
) -> subprocess.CompletedProcess:
    """`subprocess.run(capture_output=True, text=True)` that `cancel_check` can stop."""
    proc = popen(
        argv,
        stdin=subprocess.PIPE if input is not None else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=cwd,
        env=env,
    )
    outcome: dict[str, Any] = {}

    def talk() -> None:
        try:
            outcome["io"] = proc.communicate(input)
        except BaseException as exc:  # handed to the caller below
            outcome["error"] = exc

    worker = threading.Thread(target=talk, daemon=True)
    worker.start()
    while True:
        worker.join(POLL_INTERVAL)
        if not worker.is_alive():
            break
        if cancel_check():
            stop_process(proc, lambda timeout: _joined(worker, timeout))
            raise ProviderCancelled()
    if "error" in outcome:
        raise outcome["error"]
    stdout, stderr = outcome["io"]
    return subprocess.CompletedProcess(argv, proc.returncode, stdout, stderr)


def _joined(worker: threading.Thread, timeout: float) -> bool:
    worker.join(timeout)
    return not worker.is_alive()


def call_cancellable(fn: Callable[[], T], cancel_check: Callable[[], bool] | None) -> T:
    """Run `fn`, abandoning it (its late result is dropped) when `cancel_check` turns true."""
    if cancel_check is None:
        return fn()
    outcome: dict[str, Any] = {}

    def call() -> None:
        try:
            outcome["value"] = fn()
        except BaseException as exc:  # handed to the caller below
            outcome["error"] = exc

    worker = threading.Thread(target=call, daemon=True)
    worker.start()
    while True:
        worker.join(POLL_INTERVAL)
        if not worker.is_alive():
            break
        if cancel_check():
            raise ProviderCancelled()
    if "error" in outcome:
        raise outcome["error"]
    return outcome["value"]

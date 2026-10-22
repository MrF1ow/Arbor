from __future__ import annotations

import subprocess
import threading
from collections.abc import Callable, Iterable
from typing import Any

from arbor_worker.provider.base import DeltaFn, ProviderError


def run_popen_stream(
    *,
    popen: Callable[..., Any],
    argv: list[str],
    cwd,
    env: dict[str, str],
    stdin_text: str,
    on_delta: DeltaFn,
    parse_stdout: Callable[[Iterable[str], DeltaFn], str],
    label: str,
) -> str:
    proc = popen(
        argv,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=cwd,
        env=env,
    )
    stderr_lines: list[str] = []

    def drain_stderr() -> None:
        assert proc.stderr is not None
        stderr_lines.append(proc.stderr.read())

    reader = threading.Thread(target=drain_stderr, daemon=True)
    reader.start()
    try:
        assert proc.stdin is not None
        proc.stdin.write(stdin_text)
        proc.stdin.close()
        assert proc.stdout is not None
        result = parse_stdout(proc.stdout, on_delta)
        proc.stdout.close()
        reader.join()
        code = proc.wait()
        stderr = "".join(stderr_lines).strip()
        if code != 0:
            detail = stderr or "no stderr"
            raise ProviderError(f"{label} failed ({code}): {detail}")
        return result
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()

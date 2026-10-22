from __future__ import annotations

import errno
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

    stderr_reader = threading.Thread(target=drain_stderr, daemon=True)
    stderr_reader.start()

    def write_stdin() -> None:
        try:
            assert proc.stdin is not None
            proc.stdin.write(stdin_text)
            proc.stdin.close()
        except BrokenPipeError:
            pass
        except OSError as exc:
            if exc.errno != errno.EPIPE:
                raise

    stdin_writer = threading.Thread(target=write_stdin, daemon=True)
    stdin_writer.start()
    parse_error: ProviderError | None = None
    result = ""
    try:
        assert proc.stdout is not None
        try:
            result = parse_stdout(proc.stdout, on_delta)
        except ProviderError as exc:
            parse_error = exc
        close_stdout = getattr(proc.stdout, "close", None)
        if callable(close_stdout):
            close_stdout()
        stdin_writer.join()
        stderr_reader.join()
        code = proc.wait()
        stderr = "".join(stderr_lines).strip()
        if parse_error is not None:
            empty_msg = f"{label} returned empty result"
            if parse_error.args and str(parse_error.args[0]) == empty_msg and code != 0:
                detail = stderr or "no stderr"
                raise ProviderError(f"{label} failed ({code}): {detail}") from parse_error
            raise parse_error
        if code != 0:
            detail = stderr or "no stderr"
            raise ProviderError(f"{label} failed ({code}): {detail}")
        return result
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()

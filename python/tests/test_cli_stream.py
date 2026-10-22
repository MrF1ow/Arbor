import io
import threading
import time
from collections.abc import Iterable

import pytest

from arbor_worker.provider.base import DeltaFn, ProviderError
from arbor_worker.provider.cli_stream import run_popen_stream


class _FakeProc:
    def __init__(self, *, stdout, stderr: str = "", code: int = 0):
        self.stdin = io.StringIO()
        self.stdout = stdout
        self.stderr = io.StringIO(stderr)
        self._code = code
        self._alive = True

    def poll(self):
        return None if self._alive else self._code

    def wait(self):
        self._alive = False
        return self._code

    def kill(self):
        self._alive = False


class _StdoutAfterStdin:
    """Yields stdout only after the child stdin buffer is filled (simulates blocking read)."""

    def __init__(self, stdin_ready: threading.Event, lines: list[str]):
        self._stdin_ready = stdin_ready
        self._lines = lines
        self._idx = 0

    def __iter__(self):
        return self

    def __next__(self) -> str:
        if self._idx == 0:
            if not self._stdin_ready.wait(timeout=5.0):
                raise AssertionError("stdin was not written before stdout read")
        if self._idx >= len(self._lines):
            raise StopIteration
        line = self._lines[self._idx]
        self._idx += 1
        return line


def _fake_popen(proc: _FakeProc):
    def popen(*_args, **_kwargs):
        return proc

    return popen


def test_run_popen_stream_empty_result_prefers_stderr():
    proc = _FakeProc(stdout=io.StringIO(), stderr="boom on stderr", code=2)

    def parse_stdout(_lines: Iterable[str], _on_delta: DeltaFn) -> str:
        raise ProviderError("claude returned empty result")

    with pytest.raises(ProviderError, match=r"claude failed \(2\): boom on stderr"):
        run_popen_stream(
            popen=_fake_popen(proc),
            argv=["claude"],
            cwd=None,
            env={},
            stdin_text="",
            on_delta=lambda _t: None,
            parse_stdout=parse_stdout,
            label="claude",
        )


def test_run_popen_stream_tool_call_error_wins_over_exit_code():
    proc = _FakeProc(stdout=io.StringIO("line\n"), stderr="ignored", code=-9)

    def parse_stdout(_lines: Iterable[str], _on_delta: DeltaFn) -> str:
        raise ProviderError("claude reported a tool call (read_file)")

    with pytest.raises(ProviderError, match="tool call \\(read_file\\)"):
        run_popen_stream(
            popen=_fake_popen(proc),
            argv=["claude"],
            cwd=None,
            env={},
            stdin_text="",
            on_delta=lambda _t: None,
            parse_stdout=parse_stdout,
            label="claude",
        )


def test_run_popen_stream_writes_stdin_on_background_thread():
    large_stdin = "x" * 500_000
    stdin_ready = threading.Event()

    class _NotifyingStringIO(io.StringIO):
        saved = ""

        def write(self, data: str) -> int:
            n = super().write(data)
            if len(self.getvalue()) >= len(large_stdin) // 2:
                stdin_ready.set()
            return n

        def close(self) -> None:
            self.saved = self.getvalue()
            super().close()

    proc = _FakeProc(stdout=None, code=0)
    proc.stdin = _NotifyingStringIO()
    proc.stdout = _StdoutAfterStdin(
        stdin_ready,
        lines=['{"type":"result","subtype":"success","is_error":false,"result":"ok"}\n'],
    )

    def parse_stdout(lines: Iterable[str], _on_delta: DeltaFn) -> str:
        text = "".join(lines)
        assert "ok" in text
        return "ok"

    result = run_popen_stream(
        popen=_fake_popen(proc),
        argv=["claude"],
        cwd=None,
        env={},
        stdin_text=large_stdin,
        on_delta=lambda _t: None,
        parse_stdout=parse_stdout,
        label="claude",
    )
    assert result == "ok"
    assert proc.stdin.saved == large_stdin

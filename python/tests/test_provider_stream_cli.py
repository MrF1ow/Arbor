from pathlib import Path

import pytest

from arbor_worker.provider.base import ProviderRequest
from arbor_worker.provider.claude import ClaudeCliProvider
from arbor_worker.provider.grok import GrokCliProvider

FIXTURES = Path(__file__).resolve().parent / "fixtures"
GROK_STREAM = FIXTURES / "grok_stream_messages.ndjson"


class FakePopen:
    def __init__(self, argv, *, stdin=None, stdout=None, stderr=None, text=True, cwd=None, env=None):
        self.argv = argv
        self._stdout = stdout
        self.stdin = _FakeStdin()
        self.stdout = _FakeStdout(GROK_STREAM.read_text().splitlines(keepends=True))
        self.stderr = _FakeStderr()
        self.returncode = 0

    def poll(self):
        return 0

    def wait(self):
        return 0

    def kill(self):
        return None


class _FakeStdin:
    def write(self, _data: str) -> None:
        return None

    def close(self) -> None:
        return None


class _FakeStdout:
    def __init__(self, lines: list[str]):
        self._lines = list(lines)

    def __iter__(self):
        yield from self._lines

    def close(self) -> None:
        return None


class _FakeStderr:
    def read(self) -> str:
        return ""

    def close(self) -> None:
        return None


@pytest.fixture(autouse=True)
def _no_claudecode(monkeypatch):
    monkeypatch.delenv("CLAUDECODE", raising=False)


def test_grok_stream_uses_streaming_argv(tmp_path: Path):
    deltas: list[str] = []
    prov = GrokCliProvider(
        models=[],
        which=lambda _n: "/usr/bin/grok",
        popen=FakePopen,
    )
    res = prov.stream(
        ProviderRequest(prompt="go", model_id="grok-4.7", cwd=tmp_path),
        deltas.append,
    )
    assert res.markdown == "one two three four five"
    assert "".join(deltas) == "one two three four five"


def test_claude_stream_argv(tmp_path: Path):
    captured: dict = {}

    def popen(argv, **kwargs):
        captured["argv"] = argv

        class Proc(FakePopen):
            pass

        return FakePopen(argv, **kwargs)

    prov = ClaudeCliProvider(
        models=[],
        which=lambda _n: "/usr/bin/claude",
        popen=popen,
    )
    prov.stream(
        ProviderRequest(prompt="p", model_id="m", cwd=tmp_path),
        lambda _t: None,
    )
    argv = captured["argv"]
    assert "stream-json" in argv
    assert "--include-partial-messages" in argv
    assert "--verbose" in argv

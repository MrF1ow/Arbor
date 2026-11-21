"""Cancel hook on provider calls (plan I14, Q22, Q28, Q36).

A request's `cancel_check` flipping to true must stop a running CLI process (terminate,
then kill after a grace period) or abandon a blocking HTTP POST, and raise
ProviderCancelled, within about two seconds.
"""

import io
import json
import threading
import time
from pathlib import Path

import pytest

from arbor_worker.provider import cancel as cancel_mod
from arbor_worker.provider.anthropic_api import AnthropicApiProvider
from arbor_worker.provider.base import Model, ProviderRequest
from arbor_worker.provider.cancel import run_cli_cancellable
from arbor_worker.provider.claude import ClaudeCliProvider
from arbor_worker.provider.cli_stream import run_popen_stream
from arbor_worker.provider.codex import CodexCliProvider
from arbor_worker.provider.errors import ProviderCancelled
from arbor_worker.provider.grok import GrokCliProvider
from arbor_worker.provider.lmstudio import LmStudioProvider
from arbor_worker.provider.ollama import OllamaProvider
from arbor_worker.provider.openai_api import OpenAiApiProvider


@pytest.fixture(autouse=True)
def _no_claudecode(monkeypatch):
    monkeypatch.delenv("CLAUDECODE", raising=False)


class HangingPopen:
    """A process that never exits on its own.

    `terminate_ends` says whether terminate() makes communicate() return (a well
    behaved CLI) or is ignored until kill() (a stuck one).
    """

    instances: list["HangingPopen"] = []

    def __init__(self, argv, *, terminate_ends: bool = True, **kwargs):
        self.argv = argv
        self.kwargs = kwargs
        self.terminate_ends = terminate_ends
        self.returncode = None
        self.terminated = False
        self.killed = False
        self._exited = threading.Event()
        self.received_input = None
        HangingPopen.instances.append(self)

    def communicate(self, input=None, timeout=None):
        self.received_input = input
        self._exited.wait()
        return ("", "")

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        self._exited.wait(timeout)
        return self.returncode

    def terminate(self):
        self.terminated = True
        if self.terminate_ends:
            self.returncode = -15
            self._exited.set()

    def kill(self):
        self.killed = True
        self.returncode = -9
        self._exited.set()


def _hanging_popen(terminate_ends: bool = True):
    HangingPopen.instances.clear()

    def popen(argv, **kwargs):
        return HangingPopen(argv, terminate_ends=terminate_ends, **kwargs)

    return popen


class _FlagAfter:
    """cancel_check that turns true once `delay` seconds have passed."""

    def __init__(self, delay: float = 0.0):
        self._at = time.monotonic() + delay

    def __call__(self) -> bool:
        return time.monotonic() >= self._at


def _request(tmp_path: Path, cancel_check) -> ProviderRequest:
    return ProviderRequest(
        prompt="digest this", model_id="m", cwd=tmp_path, cancel_check=cancel_check
    )


def test_request_cancel_check_defaults_to_none(tmp_path: Path):
    assert ProviderRequest(prompt="p", model_id="m", cwd=tmp_path).cancel_check is None


def test_provider_cancelled_is_a_provider_error():
    from arbor_worker.provider.base import ProviderError

    assert issubclass(ProviderCancelled, ProviderError)


def test_claude_run_cancel_terminates_a_process_that_never_exits(tmp_path: Path):
    popen = _hanging_popen(terminate_ends=True)
    prov = ClaudeCliProvider(
        models=[Model("m", "M")], which=lambda name: "/usr/bin/claude", popen=popen
    )

    started = time.monotonic()
    with pytest.raises(ProviderCancelled):
        prov.run(_request(tmp_path, _FlagAfter(0.3)))
    elapsed = time.monotonic() - started

    assert elapsed < 2.5
    proc = HangingPopen.instances[0]
    assert proc.terminated
    assert not proc.killed
    assert proc.received_input == "digest this"
    assert proc.argv[0] == "/usr/bin/claude"


def test_claude_run_cancel_kills_a_process_that_ignores_terminate(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(cancel_mod, "KILL_AFTER", 0.4)
    popen = _hanging_popen(terminate_ends=False)
    prov = ClaudeCliProvider(
        models=[Model("m", "M")], which=lambda name: "/usr/bin/claude", popen=popen
    )

    started = time.monotonic()
    with pytest.raises(ProviderCancelled):
        prov.run(_request(tmp_path, lambda: True))
    elapsed = time.monotonic() - started

    proc = HangingPopen.instances[0]
    assert proc.terminated and proc.killed
    assert elapsed < 2.5


def test_claude_run_with_cancel_check_still_returns_normal_output(tmp_path: Path):
    class DonePopen:
        returncode = 0

        def __init__(self, argv, **kwargs):
            self.argv = argv

        def communicate(self, input=None, timeout=None):
            return (json.dumps({"result": "# Fine\n## Overview\nbody"}), "")

        def poll(self):
            return 0

        def wait(self, timeout=None):
            return 0

        def terminate(self):
            raise AssertionError("must not terminate a finished process")

        kill = terminate

    prov = ClaudeCliProvider(
        models=[Model("m", "M")],
        which=lambda name: "/usr/bin/claude",
        popen=DonePopen,
    )

    result = prov.run(_request(tmp_path, lambda: False))

    assert result.markdown.startswith("# Fine")


def test_claude_run_without_cancel_check_keeps_using_the_runner(tmp_path: Path):
    calls = []

    def runner(argv, **kwargs):
        calls.append(argv)

        class R:
            returncode = 0
            stdout = json.dumps({"result": "# T\n## Overview\nx"})
            stderr = ""

        return R()

    def popen(*a, **k):
        raise AssertionError("popen is only for the cancellable path")

    prov = ClaudeCliProvider(
        models=[Model("m", "M")],
        runner=runner,
        which=lambda name: "/usr/bin/claude",
        popen=popen,
    )

    prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))

    assert len(calls) == 1


def test_codex_run_cancel_terminates_a_process_that_never_exits(tmp_path: Path):
    popen = _hanging_popen(terminate_ends=True)
    prov = CodexCliProvider(
        models=[Model("m", "M")], which=lambda name: "/usr/bin/codex", popen=popen
    )

    started = time.monotonic()
    with pytest.raises(ProviderCancelled):
        prov.run(_request(tmp_path, _FlagAfter(0.3)))

    assert time.monotonic() - started < 2.5
    assert HangingPopen.instances[0].terminated
    assert HangingPopen.instances[0].argv[:2] == ["/usr/bin/codex", "exec"]


def test_codex_keeps_runner_for_auth_check_and_for_calls_without_cancel(tmp_path: Path):
    calls = []

    def runner(argv, **kwargs):
        calls.append(argv)
        if "-o" in argv:
            Path(argv[argv.index("-o") + 1]).write_text("# T\n## Overview\nx")

        class R:
            returncode = 0
            stdout = "Logged in using ChatGPT"
            stderr = ""

        return R()

    def popen(*a, **k):
        raise AssertionError("popen is only for the cancellable path")

    prov = CodexCliProvider(
        models=[Model("m", "M")],
        runner=runner,
        which=lambda name: "/usr/bin/codex",
        popen=popen,
    )

    result = prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))

    assert result.markdown.startswith("# T")


def test_grok_run_cancel_terminates_a_process_that_never_exits(tmp_path: Path):
    popen = _hanging_popen(terminate_ends=True)
    prov = GrokCliProvider(
        models=[Model("m", "M")], which=lambda name: "/usr/bin/grok", popen=popen
    )

    started = time.monotonic()
    with pytest.raises(ProviderCancelled):
        prov.run(_request(tmp_path, _FlagAfter(0.3)))

    assert time.monotonic() - started < 2.5
    assert HangingPopen.instances[0].terminated
    assert HangingPopen.instances[0].argv[0] == "/usr/bin/grok"


def test_run_cli_cancellable_returns_a_completed_process(tmp_path: Path):
    class DonePopen:
        returncode = 3

        def __init__(self, argv, **kwargs):
            self.kwargs = kwargs

        def communicate(self, input=None, timeout=None):
            return ("out", "err")

        def poll(self):
            return 3

        def wait(self, timeout=None):
            return 3

    proc = run_cli_cancellable(
        DonePopen, ["x"], input="in", cwd=tmp_path, env={}, cancel_check=lambda: False
    )

    assert (proc.returncode, proc.stdout, proc.stderr) == (3, "out", "err")


def test_run_cli_cancellable_reraises_a_communicate_failure(tmp_path: Path):
    class BoomPopen:
        returncode = None

        def __init__(self, argv, **kwargs):
            pass

        def communicate(self, input=None, timeout=None):
            raise OSError("pipe broke")

        def poll(self):
            return None

        def wait(self, timeout=None):
            return None

    with pytest.raises(OSError, match="pipe broke"):
        run_cli_cancellable(
            BoomPopen, ["x"], input="in", cwd=tmp_path, env={}, cancel_check=lambda: False
        )


class _BlockingTransport:
    """An HTTP transport whose POST never returns until released."""

    def __init__(self):
        self.release = threading.Event()
        self.entered = threading.Event()

    def __call__(self, method, url, headers, body, timeout):
        self.entered.set()
        self.release.wait(10)
        return 200, b"{}"


def _http_providers(transport):
    return [
        AnthropicApiProvider(
            models=[Model("m", "M")],
            transport=transport,
            base_url="http://127.0.0.1:9",
            api_key="sk-test-not-real",
        ),
        OpenAiApiProvider(
            models=[Model("m", "M")],
            transport=transport,
            base_url="http://127.0.0.1:9",
            api_key="sk-test-not-real",
        ),
        OllamaProvider(models=[Model("m", "M")], transport=transport, base_url="http://127.0.0.1:9"),
        LmStudioProvider(
            models=[Model("m", "M")], transport=transport, base_url="http://127.0.0.1:9/v1"
        ),
    ]


@pytest.mark.parametrize("index", range(4))
def test_http_provider_run_is_cancelled_within_a_second(index: int, tmp_path: Path):
    transport = _BlockingTransport()
    prov = _http_providers(transport)[index]
    flag = threading.Event()

    def flip():
        assert transport.entered.wait(5)
        flag.set()

    threading.Thread(target=flip, daemon=True).start()

    started = time.monotonic()
    with pytest.raises(ProviderCancelled):
        prov.run(_request(tmp_path, flag.is_set))
    elapsed = time.monotonic() - started
    transport.release.set()

    assert elapsed < 1.0


@pytest.mark.parametrize("index", range(4))
def test_http_provider_run_without_cancel_check_is_unchanged(index: int, tmp_path: Path):
    ok = {
        0: json.dumps({"content": [{"type": "text", "text": "hi"}]}).encode(),
        1: json.dumps({"choices": [{"message": {"content": "hi"}}]}).encode(),
        2: json.dumps({"message": {"content": "hi"}}).encode(),
        3: json.dumps({"choices": [{"message": {"content": "hi"}}]}).encode(),
    }[index]
    prov = _http_providers(lambda *a: (200, ok))[index]

    result = prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))

    assert result.markdown == "hi"


@pytest.mark.parametrize("index", range(4))
def test_http_provider_run_with_idle_cancel_check_returns_the_response(index: int, tmp_path: Path):
    ok = {
        0: json.dumps({"content": [{"type": "text", "text": "hi"}]}).encode(),
        1: json.dumps({"choices": [{"message": {"content": "hi"}}]}).encode(),
        2: json.dumps({"message": {"content": "hi"}}).encode(),
        3: json.dumps({"choices": [{"message": {"content": "hi"}}]}).encode(),
    }[index]
    prov = _http_providers(lambda *a: (200, ok))[index]

    result = prov.run(_request(tmp_path, lambda: False))

    assert result.markdown == "hi"


class _StreamProc:
    """A streaming CLI whose stdout blocks until the process is terminated."""

    def __init__(self, *, terminate_ends: bool = True):
        self.stdin = io.StringIO()
        self.stderr = io.StringIO("")
        self.terminate_ends = terminate_ends
        self.terminated = False
        self.killed = False
        self._dead = threading.Event()
        self._code = None
        proc = self

        class _Stdout:
            def __iter__(self):
                return self

            def __next__(self):
                proc._dead.wait(10)
                raise StopIteration

            def close(self):
                pass

        self.stdout = _Stdout()

    def poll(self):
        return self._code

    def wait(self, timeout=None):
        self._dead.wait(timeout)
        return self._code

    def terminate(self):
        self.terminated = True
        if self.terminate_ends:
            self._code = -15
            self._dead.set()

    def kill(self):
        self.killed = True
        self._code = -9
        self._dead.set()


def test_run_popen_stream_cancel_terminates_and_raises(tmp_path: Path):
    proc = _StreamProc()

    def parse_stdout(lines, on_delta):
        for _ in lines:
            pass
        return ""

    started = time.monotonic()
    with pytest.raises(ProviderCancelled):
        run_popen_stream(
            popen=lambda *a, **k: proc,
            argv=["x"],
            cwd=tmp_path,
            env={},
            stdin_text="hi",
            on_delta=lambda _t: None,
            parse_stdout=parse_stdout,
            label="claude",
            cancel_check=_FlagAfter(0.2),
        )

    assert time.monotonic() - started < 2.5
    assert proc.terminated


def test_run_popen_stream_cancel_kills_after_the_grace_period(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(cancel_mod, "KILL_AFTER", 0.3)
    proc = _StreamProc(terminate_ends=False)

    def parse_stdout(lines, on_delta):
        for _ in lines:
            pass
        return ""

    with pytest.raises(ProviderCancelled):
        run_popen_stream(
            popen=lambda *a, **k: proc,
            argv=["x"],
            cwd=tmp_path,
            env={},
            stdin_text="hi",
            on_delta=lambda _t: None,
            parse_stdout=parse_stdout,
            label="claude",
            cancel_check=lambda: True,
        )

    assert proc.terminated and proc.killed


def test_claude_stream_passes_the_request_cancel_check(tmp_path: Path):
    proc = _StreamProc()
    prov = ClaudeCliProvider(
        models=[Model("m", "M")],
        which=lambda name: "/usr/bin/claude",
        popen=lambda *a, **k: proc,
    )

    with pytest.raises(ProviderCancelled):
        prov.stream(_request(tmp_path, _FlagAfter(0.2)), lambda _t: None)

    assert proc.terminated

from __future__ import annotations

import io
import json
import os
import queue
import threading
import time
from pathlib import Path

import pytest

from arbor_worker.usage import (
    GROK_BILLING_URL,
    GROK_PROBE_FAILED_MESSAGE,
    claude_usage_response_to_limits,
    codex_rate_limits_to_limits,
    grok_billing_http_transport,
    grok_usage_response_to_limits,
    parse_period_boundary,
    read_claude_usage,
    read_codex_usage,
    read_grok_credential,
    read_grok_usage,
    read_provider_usage,
)


CHECKED = "2026-07-18T10:00:00.000Z"


def test_claude_maps_session_weekly_and_model_scoped():
    result = claude_usage_response_to_limits(
        checked_at=CHECKED,
        response={
            "rate_limits_available": True,
            "rate_limits": {
                "five_hour": {"utilization": 54, "resets_at": "2026-07-18T14:39:00Z"},
                "seven_day": {"utilization": 18.4, "resets_at": "2026-07-24T08:59:00+00:00"},
                "model_scoped": [
                    {"display_name": "Opus", "utilization": 40, "resets_at": "2026-07-24T08:59:00Z"},
                ],
                "extra_usage": {
                    "is_enabled": False,
                    "monthly_limit": None,
                    "used_credits": None,
                    "utilization": None,
                },
            },
        },
    )
    labels = [w["label"] for w in result["windows"]]
    assert labels == ["Session", "Weekly", "Weekly · Opus"]
    assert result["windows"][0]["used_percent"] == 54


def test_claude_unavailable_when_rate_limits_missing():
    result = claude_usage_response_to_limits(
        checked_at=CHECKED,
        response={"rate_limits_available": False, "rate_limits": None},
    )
    assert result["unavailable"]["reason"] == "unsupported"


@pytest.fixture(autouse=True)
def _clear_claudecode_env(monkeypatch):
    monkeypatch.delenv("CLAUDECODE", raising=False)


class FakePopen:
    instances: list["FakePopen"] = []

    def __init__(self, argv, stdin=None, stdout=None, stderr=None, text=True, env=None, cwd=None):
        self.argv = argv
        self._stdin_buffer = io.StringIO()
        self.stdin = self._StdinProxy(self._stdin_buffer)
        self._stdout_lines: list[str] = []
        self._stderr_data = ""
        self._lock = threading.Lock()
        self._closed = False
        self._running = True
        self.terminated = False
        self.killed = False
        FakePopen.instances.append(self)

    class _StdinProxy:
        def __init__(self, buffer: io.StringIO) -> None:
            self._buffer = buffer

        def write(self, text: str) -> int:
            return self._buffer.write(text)

        def close(self) -> None:
            self._buffer.seek(0)

        def flush(self) -> None:
            pass

        def getvalue(self) -> str:
            return self._buffer.getvalue()

    def set_stdout_lines(self, lines: list[str]) -> None:
        self._stdout_lines = lines

    def set_stderr_data(self, data: str) -> None:
        self._stderr_data = data

    def stdin_text(self) -> str:
        return self.stdin.getvalue()

    @property
    def stdout(self):
        return self

    @property
    def stderr(self):
        return io.StringIO(self._stderr_data)

    def __iter__(self):
        for line in self._stdout_lines:
            yield line

    def poll(self):
        return None if self._running else 0

    def wait(self, timeout=None):
        self._running = False
        return 0

    def terminate(self):
        self.terminated = True
        self._running = False

    def kill(self):
        self.killed = True
        self._running = False


def test_read_claude_usage_writes_control_requests_and_maps_success():
    FakePopen.instances.clear()
    success = {
        "type": "control_response",
        "response": {
            "request_id": "arbor-usage",
            "subtype": "success",
            "response": {
                "rate_limits_available": True,
                "rate_limits": {
                    "five_hour": {"utilization": 62, "resets_at": None},
                    "seven_day": {"utilization": 18, "resets_at": None},
                },
            },
        },
    }

    def popen_factory(*args, **kwargs):
        proc = FakePopen(*args, **kwargs)
        proc.set_stdout_lines([json.dumps(success) + "\n"])
        return proc

    limits = read_claude_usage(popen=popen_factory, which=lambda _: "/bin/claude")
    assert limits["windows"][0]["used_percent"] == 62
    proc = FakePopen.instances[0]
    written = proc.stdin_text()
    assert "arbor-init" in written
    assert "get_usage" in written
    assert written.count("\n") >= 2


def test_read_claude_usage_error_subtype_probe_failed():
    FakePopen.instances.clear()
    err = {
        "type": "control_response",
        "response": {"request_id": "arbor-usage", "subtype": "error"},
    }

    def popen_factory(*args, **kwargs):
        proc = FakePopen(*args, **kwargs)
        proc.set_stdout_lines([json.dumps(err) + "\n"])
        return proc

    limits = read_claude_usage(popen=popen_factory, which=lambda _: "/bin/claude")
    assert limits["unavailable"]["reason"] == "probe_failed"


def test_read_claude_usage_timeout_probe_failed():
    FakePopen.instances.clear()

    class _BlockingStdout:
        def __iter__(self):
            while True:
                time.sleep(0.02)
                yield from ()

    class SilentPopen(FakePopen):
        @property
        def stdout(self):
            return _BlockingStdout()

    def popen_factory(*args, **kwargs):
        proc = SilentPopen(*args, **kwargs)
        proc.set_stdout_lines([])
        return proc

    start = time.monotonic()
    limits = read_claude_usage(popen=popen_factory, which=lambda _: "/bin/claude", timeout=0.15)
    elapsed = time.monotonic() - start
    assert limits["unavailable"]["reason"] == "probe_failed"
    assert elapsed < 0.15 + 0.5
    proc = FakePopen.instances[0]
    assert proc.terminated or proc.killed


def test_read_claude_usage_claudecode_guard(monkeypatch):
    monkeypatch.setenv("CLAUDECODE", "1")
    from arbor_worker.provider.claude import CLAUDECODE_GUARD

    limits = read_claude_usage(popen=FakePopen, which=lambda _: "/bin/claude")
    assert limits["unavailable"]["reason"] == "probe_failed"
    assert limits["unavailable"]["message"] == CLAUDECODE_GUARD


def test_read_claude_usage_drains_large_stderr_within_timeout():
    FakePopen.instances.clear()
    big_stderr = "x" * 200_000

    def popen_factory(*args, **kwargs):
        proc = FakePopen(*args, **kwargs)
        proc.set_stderr_data(big_stderr)
        proc.set_stdout_lines([])
        return proc

    start = time.monotonic()
    limits = read_claude_usage(popen=popen_factory, which=lambda _: "/bin/claude", timeout=0.2)
    assert time.monotonic() - start < 0.2 + 0.5
    assert limits["unavailable"]["reason"] == "probe_failed"
    assert FakePopen.instances[0].terminated or FakePopen.instances[0].killed


def test_read_claude_usage_error_subtype_terminates():
    FakePopen.instances.clear()
    err = {
        "type": "control_response",
        "response": {"request_id": "arbor-usage", "subtype": "error"},
    }

    def popen_factory(*args, **kwargs):
        proc = FakePopen(*args, **kwargs)
        proc.set_stdout_lines([json.dumps(err) + "\n"])
        return proc

    read_claude_usage(popen=popen_factory, which=lambda _: "/bin/claude")
    assert FakePopen.instances[0].terminated or FakePopen.instances[0].killed


def test_codex_free_plan_monthly_fallback():
    result = codex_rate_limits_to_limits(
        checked_at=CHECKED,
        snapshot={"planType": "free", "primary": {"usedPercent": 80, "resetsAt": None}},
        rate_limits_by_limit_id=None,
    )
    assert result["windows"][0]["kind"] == "monthly"
    assert result["windows"][0]["used_percent"] == 80


def test_codex_limit_id_filter_uses_codex_bucket():
    spark = {
        "limitId": "codex_bengalfox",
        "secondary": {"usedPercent": 90, "windowDurationMins": 10080},
    }
    result = codex_rate_limits_to_limits(
        checked_at=CHECKED,
        snapshot=spark,
        rate_limits_by_limit_id={
            "codex_bengalfox": spark,
            "codex": {"secondary": {"usedPercent": 42, "windowDurationMins": 10080}},
        },
    )
    assert len(result["windows"]) == 1
    assert result["windows"][0]["used_percent"] == 42


def test_codex_individual_limit():
    result = codex_rate_limits_to_limits(
        checked_at=CHECKED,
        snapshot={
            "limitId": "codex",
            "individualLimit": {"remainingPercent": 99, "resetsAt": 1_784_500_000},
        },
        rate_limits_by_limit_id=None,
    )
    assert result["windows"][-1]["label"] == "Monthly credit limit"
    assert result["windows"][-1]["used_percent"] == 1


def test_read_codex_usage_json_rpc_flow():
    FakePopen.instances.clear()
    init_resp = {"id": 1, "result": {"userAgent": "mock"}}
    rate_resp = {
        "id": 2,
        "result": {
            "rateLimits": {
                "planType": "plus",
                "primary": {"usedPercent": 12, "windowDurationMins": 300},
            }
        },
    }

    def popen_factory(*args, **kwargs):
        proc = FakePopen(*args, **kwargs)
        proc.set_stdout_lines(
            [json.dumps(init_resp) + "\n", json.dumps(rate_resp) + "\n"]
        )
        return proc

    limits = read_codex_usage(popen=popen_factory, which=lambda _: "/bin/codex")
    assert limits["windows"][0]["used_percent"] == 12
    proc = FakePopen.instances[0]
    assert "app-server" in proc.argv
    written = proc.stdin_text()
    assert written.index("initialize") < written.index("initialized")
    assert written.index("initialized") < written.index("rateLimits/read")


def test_read_codex_usage_init_error_probe_failed():
    FakePopen.instances.clear()
    init_err = {"id": 1, "error": {"code": -32603, "message": "fail"}}

    def popen_factory(*args, **kwargs):
        proc = FakePopen(*args, **kwargs)
        proc.set_stdout_lines([json.dumps(init_err) + "\n"])
        return proc

    limits = read_codex_usage(popen=popen_factory, which=lambda _: "/bin/codex")
    assert limits["unavailable"]["reason"] == "probe_failed"
    assert FakePopen.instances[0].terminated or FakePopen.instances[0].killed


def test_grok_zero_percent_with_valid_period():
    weekly = {
        "type": "USAGE_PERIOD_TYPE_WEEKLY",
        "start": "2026-02-23T00:00:00.000Z",
        "end": "2026-03-02T00:00:00.000Z",
    }
    result = grok_usage_response_to_limits(
        {"config": {"currentPeriod": weekly}},
        CHECKED,
    )
    assert result["windows"][0]["used_percent"] == 0


def test_grok_invalid_period_empty_windows():
    weekly = {
        "type": "USAGE_PERIOD_TYPE_WEEKLY",
        "start": "invalid",
        "end": "2026-03-02T00:00:00.000Z",
    }
    result = grok_usage_response_to_limits(
        {"config": {"currentPeriod": weekly}},
        CHECKED,
    )
    assert result["windows"] == []


def test_read_grok_credential_skips_api_key_and_overrides(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("XAI_API_KEY", "secret")
    assert read_grok_credential({"XAI_API_KEY": "secret"}, system_config_paths=[]) is None
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    env = {"GROK_MODELS_BASE_URL": "https://custom.example", "GROK_HOME": str(tmp_path)}
    assert read_grok_credential(env, home=tmp_path, system_config_paths=[]) is None


def test_read_grok_usage_api_key_auth_unsupported(tmp_path: Path):
    auth = {
        "https://accounts.x.ai/sign-in": {"key": "k", "auth_mode": "api_key"},
    }
    env = {"GROK_HOME": str(tmp_path), "GROK_AUTH": json.dumps(auth)}
    limits = read_grok_usage(
        env=env,
        home=tmp_path,
        system_config_paths=[],
        transport=lambda *a, **k: (_ for _ in ()).throw(AssertionError("no transport")),
    )
    assert limits["unavailable"]["reason"] == "unsupported"


def test_read_grok_usage_http_401_fixed_message(tmp_path: Path):
    token = "super-secret-session-token"
    auth = {"https://accounts.x.ai/sign-in": {"key": token}}
    env = {"GROK_HOME": str(tmp_path), "GROK_AUTH": json.dumps(auth)}
    calls = []

    def transport(method, url, headers=None, timeout=10):
        calls.append((method, url, headers))
        return 401, "unauthorized body with " + token, "denied"

    limits = read_grok_usage(
        env=env,
        home=tmp_path,
        system_config_paths=[],
        transport=transport,
    )
    assert calls[0][0] == "GET"
    assert calls[0][1] == GROK_BILLING_URL
    assert calls[0][2]["Authorization"] == f"Bearer {token}"
    assert limits["unavailable"]["reason"] == "probe_failed"
    assert limits["unavailable"]["message"] == GROK_PROBE_FAILED_MESSAGE


def test_read_provider_usage_ollama_unsupported():
    result = read_provider_usage("ollama")
    assert result["unavailable"]["reason"] == "unsupported"


def test_read_provider_usage_codex_defaults_to_subprocess_popen(monkeypatch):
    # cmd_usage calls read_provider_usage(provider) with no popen; it must fall back to the real one.
    FakePopen.instances.clear()
    rate_err = {"id": 2, "error": {"code": -32600, "message": "codex account authentication required"}}

    def popen_factory(*args, **kwargs):
        proc = FakePopen(*args, **kwargs)
        proc.set_stdout_lines(
            [json.dumps({"id": 1, "result": {}}) + "\n", json.dumps(rate_err) + "\n"]
        )
        return proc

    monkeypatch.setattr("arbor_worker.usage.subprocess.Popen", popen_factory)
    monkeypatch.setattr("arbor_worker.usage.resolve_codex_command", lambda *_: "/bin/codex")
    limits = read_provider_usage("codex")
    assert limits["unavailable"] == {
        "reason": "probe_failed",
        "message": "codex account authentication required",
    }
    assert FakePopen.instances


def test_read_provider_usage_claude_defaults_to_subprocess_popen(monkeypatch):
    monkeypatch.delenv("CLAUDECODE", raising=False)
    FakePopen.instances.clear()
    monkeypatch.setattr("arbor_worker.usage.subprocess.Popen", FakePopen)
    monkeypatch.setattr("arbor_worker.usage.resolve_cli_command", lambda *_: "/bin/claude")
    limits = read_provider_usage("claude", timeout=0.2)
    assert limits["unavailable"]["reason"] == "probe_failed"
    assert FakePopen.instances


class _AppServerPopen(FakePopen):
    """Single shared stdout that only answers a request after it is written, like the real app-server."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._out: "queue.Queue[str | None]" = queue.Queue()
        server = self

        class _Stdin(FakePopen._StdinProxy):
            def write(self, text: str) -> int:
                for raw in text.splitlines():
                    message = json.loads(raw)
                    if message.get("id") == 1:
                        server._out.put(json.dumps({"id": 1, "result": {}}) + "\n")
                    elif message.get("id") == 2:
                        server._out.put(json.dumps({
                            "id": 2,
                            "result": {"rateLimits": {"primary": {"usedPercent": 40, "windowDurationMins": 300}}},
                        }) + "\n")
                return super().write(text)

        self.stdin = _Stdin(self._stdin_buffer)

    def __iter__(self):
        while (line := self._out.get()) is not None:
            yield line

    def terminate(self):
        super().terminate()
        self._out.put(None)


def test_read_codex_usage_reads_reply_sent_after_handshake():
    limits = read_codex_usage(popen=_AppServerPopen, which=lambda _: "/bin/codex", timeout=2)
    assert limits["windows"][0]["used_percent"] == 40

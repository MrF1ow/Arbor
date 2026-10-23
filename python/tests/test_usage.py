from __future__ import annotations

import io
import json
import os
import threading
import time
from pathlib import Path

import pytest

from arbor_worker.usage import (
    claude_usage_response_to_limits,
    codex_rate_limits_to_limits,
    grok_usage_response_to_limits,
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


class FakePopen:
    instances: list["FakePopen"] = []

    def __init__(self, argv, stdin=None, stdout=None, stderr=None, text=True, env=None, cwd=None):
        self.argv = argv
        self._stdin_buffer = io.StringIO()
        self.stdin = self._StdinProxy(self._stdin_buffer)
        self._stdout_lines: list[str] = []
        self._lock = threading.Lock()
        self._closed = False
        self._proc = self
        FakePopen.instances.append(self)

    class _StdinProxy:
        def __init__(self, buffer: io.StringIO) -> None:
            self._buffer = buffer

        def write(self, text: str) -> int:
            return self._buffer.write(text)

        def close(self) -> None:
            self._buffer.seek(0)

        def getvalue(self) -> str:
            return self._buffer.getvalue()

    def set_stdout_lines(self, lines: list[str]) -> None:
        self._stdout_lines = lines

    def stdin_text(self) -> str:
        return self.stdin.getvalue()

    @property
    def stdout(self):
        return self

    def __iter__(self):
        for line in self._stdout_lines:
            yield line

    def poll(self):
        return 0

    def wait(self, timeout=None):
        return 0

    def terminate(self):
        pass

    def kill(self):
        pass


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

    class SlowPopen(FakePopen):
        def __iter__(self):
            time.sleep(0.05)
            yield from super().__iter__()

    def popen_factory(*args, **kwargs):
        proc = SlowPopen(*args, **kwargs)
        proc.set_stdout_lines([])
        return proc

    limits = read_claude_usage(popen=popen_factory, which=lambda _: "/bin/claude", timeout=0.01)
    assert limits["unavailable"]["reason"] == "probe_failed"


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
    assert "app-server" in FakePopen.instances[0].argv


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
    assert read_grok_credential({"XAI_API_KEY": "secret"}) is None
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    monkeypatch.setenv("GROK_MODELS_BASE_URL", "https://custom.example")
    assert read_grok_credential(os.environ) is None


def test_read_grok_usage_api_key_auth_unsupported(tmp_path: Path):
    auth = {
        "https://accounts.x.ai/sign-in": {"key": "k", "auth_mode": "api_key"},
    }
    env = {"GROK_HOME": str(tmp_path), "GROK_AUTH": json.dumps(auth)}
    limits = read_grok_usage(env=env, transport=lambda *a, **k: (200, "{}", ""))
    assert limits["unavailable"]["reason"] == "unsupported"


def test_read_grok_usage_http_401_redacts_token(tmp_path: Path):
    token = "super-secret-session-token"
    auth = {"https://accounts.x.ai/sign-in": {"key": token}}
    env = {"GROK_AUTH": json.dumps(auth)}

    def transport(method, url, headers=None, timeout=10):
        assert headers["Authorization"] == f"Bearer {token}"
        return 401, "unauthorized", "denied"

    limits = read_grok_usage(env=env, transport=transport)
    assert limits["unavailable"]["reason"] == "probe_failed"
    message = limits["unavailable"].get("message", "")
    assert token not in message


def test_read_provider_usage_ollama_unsupported():
    result = read_provider_usage("ollama")
    assert result["unavailable"]["reason"] == "unsupported"

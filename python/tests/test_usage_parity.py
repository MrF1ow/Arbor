"""T3 mapping parity for provider usage readers."""

from __future__ import annotations

import io
import json
import math
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
    read_grok_credential,
    read_grok_usage,
)

CHECKED = "2026-07-18T10:00:00.000Z"
WEEKLY_PERIOD = {
    "type": "USAGE_PERIOD_TYPE_WEEKLY",
    "start": "2026-09-11T03:10:30.159171+00:00",
    "end": "2026-09-18T03:10:30.159171+00:00",
}


def test_claude_skips_null_utilization_and_clamps_250():
    windows = claude_usage_response_to_limits(
        checked_at=CHECKED,
        response={
            "rate_limits_available": True,
            "rate_limits": {
                "five_hour": {"utilization": None, "resets_at": None},
                "seven_day": {"utilization": 250, "resets_at": None},
            },
        },
    )["windows"]
    assert len(windows) == 1
    assert windows[0]["used_percent"] == 100


def test_claude_enterprise_spend_prefers_spend_over_extra_utilization():
    enterprise = {
        "rate_limits_available": True,
        "rate_limits": {
            "five_hour": {"utilization": 12, "resets_at": None},
            "spend": {
                "enabled": True,
                "used": {"amount_minor": 4_631, "currency": "USD", "exponent": 2},
                "limit": {"amount_minor": 50_000, "currency": "USD", "exponent": 2},
            },
            "extra_usage": {
                "is_enabled": True,
                "used_credits": 30_000,
                "monthly_limit": 50_000,
                "utilization": 60,
            },
        },
    }
    windows = claude_usage_response_to_limits(checked_at=CHECKED, response=enterprise)["windows"]
    assert windows[0]["label"] == "Session"
    monthly = next(w for w in windows if w["id"] == "monthly_spend")
    assert monthly["used_percent"] == pytest.approx(9.262, rel=1e-3)


def test_claude_extra_usage_fallbacks_and_disabled_budgets():
    base = {
        "rate_limits_available": True,
        "rate_limits": {
            "spend": {
                "enabled": False,
                "used": {"amount_minor": 30_000, "currency": "USD", "exponent": 2},
                "limit": {"amount_minor": 50_000, "currency": "USD", "exponent": 2},
            },
            "extra_usage": {
                "is_enabled": True,
                "used_credits": 4_631,
                "monthly_limit": 50_000,
                "utilization": 9,
            },
        },
    }
    assert claude_usage_response_to_limits(checked_at=CHECKED, response=base)["windows"]
    util_only = {
        **base,
        "rate_limits": {
            **base["rate_limits"],
            "spend": {"enabled": True, "used": None, "limit": None},
            "extra_usage": {
                **base["rate_limits"]["extra_usage"],
                "used_credits": None,
                "monthly_limit": None,
            },
        },
    }
    assert claude_usage_response_to_limits(checked_at=CHECKED, response=util_only)["windows"]
    disabled = {
        **base,
        "rate_limits": {
            **base["rate_limits"],
            "extra_usage": {**base["rate_limits"]["extra_usage"], "is_enabled": False},
        },
    }
    assert claude_usage_response_to_limits(checked_at=CHECKED, response=disabled)["windows"] == []
    mismatch = {
        **base,
        "rate_limits": {
            **base["rate_limits"],
            "spend": {
                **base["rate_limits"]["spend"],
                "limit": {"amount_minor": 50_000, "currency": "EUR", "exponent": 2},
            },
            "extra_usage": {**base["rate_limits"]["extra_usage"], "is_enabled": False},
        },
    }
    assert claude_usage_response_to_limits(checked_at=CHECKED, response=mismatch)["windows"] == []


def test_claude_only_first_numeric_model_scoped_row():
    result = claude_usage_response_to_limits(
        checked_at=CHECKED,
        response={
            "rate_limits_available": True,
            "rate_limits": {
                "model_scoped": [
                    {"display_name": "Ghost", "utilization": None, "resets_at": None},
                    {"display_name": "Fable", "utilization": 5, "resets_at": None},
                ],
            },
        },
    )
    labels = [w["label"] for w in result["windows"]]
    assert labels == ["Weekly · Fable"]


def test_codex_primary_secondary_durations_and_go_plan():
    plus = codex_rate_limits_to_limits(
        checked_at=CHECKED,
        snapshot={
            "planType": "plus",
            "primary": {"usedPercent": 12, "resetsAt": 1_784_000_000, "windowDurationMins": 300},
            "secondary": {"usedPercent": 47, "resetsAt": 1_784_500_000, "windowDurationMins": 10080},
        },
        rate_limits_by_limit_id=None,
    )
    assert plus["windows"][0]["kind"] == "session"
    assert plus["windows"][1]["kind"] == "weekly"
    go = codex_rate_limits_to_limits(
        checked_at=CHECKED,
        snapshot={"planType": "go", "primary": {"usedPercent": 55, "resetsAt": None}},
        rate_limits_by_limit_id=None,
    )
    assert go["windows"][0]["kind"] == "monthly"
    assert go["windows"][0]["window_minutes"] == 43_200


@pytest.mark.parametrize("by_id", [None, {}, {"codex": None}])
def test_codex_legacy_rate_limits_by_limit_id(by_id):
    snapshot = {"primary": {"usedPercent": 12, "windowDurationMins": 300}}
    assert codex_rate_limits_to_limits(
        checked_at=CHECKED,
        snapshot=snapshot,
        rate_limits_by_limit_id=by_id,
    ) == codex_rate_limits_to_limits(
        checked_at=CHECKED,
        snapshot=snapshot,
        rate_limits_by_limit_id=None,
    )


def test_codex_spark_snapshot_does_not_leak_individual_limit():
    spark = {
        "limitId": "codex_bengalfox",
        "individualLimit": {"remainingPercent": 99, "resetsAt": 1_784_500_000},
        "secondary": {"usedPercent": 90, "windowDurationMins": 10080},
    }
    windows = codex_rate_limits_to_limits(
        checked_at=CHECKED,
        snapshot=spark,
        rate_limits_by_limit_id={
            "codex_bengalfox": spark,
            "codex": {"secondary": {"usedPercent": 42, "windowDurationMins": 10080}},
        },
    )["windows"]
    assert len(windows) == 1
    assert all(w["id"] != "individual" for w in windows)


def test_grok_zero_percent_periods_and_ms_reset():
    for period, kind, label in [
        (WEEKLY_PERIOD, "weekly", "Weekly"),
        (
            {
                "type": "USAGE_PERIOD_TYPE_MONTHLY",
                "start": "2026-09-01T00:00:00.000Z",
                "end": "2026-10-01T00:00:00.000Z",
            },
            "monthly",
            "Monthly",
        ),
    ]:
        result = grok_usage_response_to_limits({"config": {"currentPeriod": period}}, CHECKED)
        assert result["windows"][0]["used_percent"] == 0
        assert result["windows"][0]["kind"] == kind
        assert result["windows"][0]["label"] == label


def test_grok_incomplete_daily_unordered_unknown_periods():
    cases = [
        None,
        {**WEEKLY_PERIOD, "type": None},
        {**WEEKLY_PERIOD, "type": "USAGE_PERIOD_TYPE_DAILY"},
        {**WEEKLY_PERIOD, "start": None},
        {**WEEKLY_PERIOD, "end": None},
        {**WEEKLY_PERIOD, "start": "invalid"},
        {**WEEKLY_PERIOD, "start": WEEKLY_PERIOD["end"], "end": WEEKLY_PERIOD["start"]},
    ]
    for period in cases:
        payload = {"config": {"currentPeriod": period}} if period else {"config": {}}
        assert grok_usage_response_to_limits(payload, CHECKED)["windows"] == []


def test_grok_feb_30_and_24_00_boundaries():
    for start, end in [
        ("2026-02-30T00:00:00.000Z", "2026-03-09T00:00:00.000Z"),
        ("2026-02-23T00:00:00.000Z", "2026-02-30T00:00:00.000Z"),
    ]:
        period = {**WEEKLY_PERIOD, "start": start, "end": end}
        assert grok_usage_response_to_limits({"config": {"currentPeriod": period}}, CHECKED)[
            "windows"
        ] == []
    assert math.isnan(parse_period_boundary("2026-03-01T24:00:00.000Z"))


def test_grok_clamp_and_subscription_label():
    assert grok_usage_response_to_limits({"config": {"creditUsagePercent": 0}}, CHECKED)["windows"][
        0
    ]["label"] == "Subscription"
    clamped = grok_usage_response_to_limits(
        {
            "config": {
                "creditUsagePercent": 120,
                "currentPeriod": {"type": "USAGE_PERIOD_TYPE_MONTHLY", "end": "invalid"},
            }
        },
        CHECKED,
    )["windows"][0]
    assert clamped["used_percent"] == 100
    assert clamped["kind"] == "monthly"


def test_read_grok_prefers_current_login_scope(tmp_path: Path):
    auth = {
        "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828": {"key": "session-token"},
        "https://accounts.x.ai/sign-in": {"key": "legacy-token"},
    }
    seen = []

    def transport(method, url, headers=None, timeout=10):
        seen.append(headers["Authorization"])
        body = json.dumps({"config": {"creditUsagePercent": 37}})
        return 200, body, ""

    limits = read_grok_usage(
        env={"GROK_HOME": str(tmp_path), "GROK_AUTH": json.dumps(auth)},
        home=tmp_path,
        system_config_paths=[],
        transport=transport,
    )
    assert seen == ["Bearer session-token"]
    assert limits["windows"][0]["used_percent"] == 37


def test_read_grok_auth_skips_auth_json(tmp_path: Path, monkeypatch):
    (tmp_path / "auth.json").write_text('{"https://accounts.x.ai/sign-in":{"key":"file-token"}}')

    def transport(method, url, headers=None, timeout=10):
        assert headers["Authorization"] == "Bearer legacy-token"
        return 200, json.dumps({"config": {"creditUsagePercent": 12}}), ""

    limits = read_grok_usage(
        env={
            "GROK_HOME": str(tmp_path),
            "GROK_AUTH": '{"https://accounts.x.ai/sign-in":{"key":"legacy-token"}}',
        },
        home=tmp_path,
        system_config_paths=[],
        transport=transport,
    )
    assert limits["windows"][0]["used_percent"] == 12


def test_read_grok_credential_grok_auth_does_not_read_auth_json(tmp_path: Path):
    auth_path = str(tmp_path / "auth.json")

    def read_text(path: str) -> str:
        if path.endswith("auth.json"):
            raise AssertionError("must not read auth.json")
        return ""

    cred = read_grok_credential(
        {
            "GROK_AUTH": '{"https://accounts.x.ai/sign-in":{"key":"legacy-token"}}',
            "GROK_HOME": str(tmp_path),
        },
        home=tmp_path,
        system_config_paths=[],
        read_text=read_text,
    )
    assert cred is not None
    assert cred.get("key") == "legacy-token"


@pytest.mark.parametrize(
    "environment",
    [
        {"GROK_AUTH": '{"https://other.example":{"key":"unrelated"}}'},
        {"GROK_AUTH": '{"https://accounts.x.ai/sign-in":{"key":"t"}}', "GROK_OIDC_ISSUER": "x"},
        {"GROK_AUTH": '{"https://accounts.x.ai/sign-in":{"key":"t"}}', "GROK_OAUTH2_PRINCIPAL_ID": "id"},
        {"GROK_AUTH": '{"https://accounts.x.ai/sign-in":{"key":"t"}}', "GROK_CONFIG": "{}"},
        {"GROK_AUTH": '{"https://accounts.x.ai/sign-in":{"key":"t"}}', "GROK_CONFIG_PATH": "/x"},
        {"GROK_AUTH": '{"https://accounts.x.ai/sign-in":{"key":"t"}}', "XAI_API_KEY": "k"},
    ],
)
def test_read_grok_skip_matrix(tmp_path: Path, environment: dict[str, str]):
    limits = read_grok_usage(
        env={"GROK_HOME": str(tmp_path), **environment},
        home=tmp_path,
        system_config_paths=[],
        transport=lambda *a, **k: (_ for _ in ()).throw(AssertionError("no transport")),
    )
    assert limits["unavailable"]["reason"] == "unsupported"


def test_read_grok_blank_key_probe_failed(tmp_path: Path):
    limits = read_grok_usage(
        env={
            "GROK_HOME": str(tmp_path),
            "GROK_AUTH": '{"https://accounts.x.ai/sign-in":{"key":" "}}',
        },
        home=tmp_path,
        system_config_paths=[],
        transport=lambda *a, **k: (_ for _ in ()).throw(AssertionError("no transport")),
    )
    assert limits["unavailable"]["reason"] == "probe_failed"


def test_read_grok_malformed_credentials_and_key_type(tmp_path: Path):
    for contents in ["not-json", '{"https://accounts.x.ai/sign-in":{"key":42}}']:
        limits = read_grok_usage(
            env={"GROK_HOME": str(tmp_path), "GROK_AUTH": contents},
            home=tmp_path,
            system_config_paths=[],
            transport=lambda *a, **k: (_ for _ in ()).throw(AssertionError("no transport")),
        )
        assert limits["unavailable"]["reason"] == "probe_failed"
        assert limits["unavailable"]["message"] == GROK_PROBE_FAILED_MESSAGE


def test_grok_billing_http_transport_with_stub_opener(monkeypatch):
    from arbor_worker.provider import http_transport

    class FakeResponse:
        status = 200

        def read(self):
            return b'{"config":{"creditUsagePercent":25}}'

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    class FakeOpener:
        def open(self, req, timeout=None):
            assert req.get_method() == "GET"
            assert req.full_url == "https://cli-chat-proxy.grok.com/v1/billing?format=credits"
            return FakeResponse()

    monkeypatch.setattr(http_transport, "_http_opener", lambda: FakeOpener())
    status, body, err = grok_billing_http_transport(
        "GET",
        "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
        {"Authorization": "Bearer t"},
        10,
    )
    assert status == 200
    assert json.loads(body)["config"]["creditUsagePercent"] == 25
    assert err == ""

    class ErrResponse:
        def read(self):
            return b"secret"

        def close(self):
            pass

    class ErrOpener:
        def open(self, req, timeout=None):
            import urllib.error

            raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, ErrResponse())

    monkeypatch.setattr(http_transport, "_http_opener", lambda: ErrOpener())
    status, body, _ = grok_billing_http_transport("GET", GROK_BILLING_URL, {}, 10)
    assert status == 401

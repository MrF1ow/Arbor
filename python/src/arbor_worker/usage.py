"""Provider usage limit readers (T3 Code parity)."""

from __future__ import annotations

import json
import math
import os
import queue
import re
import shutil
import subprocess
import threading
import time
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from arbor_worker import __version__
from arbor_worker.auth import gui_path, resolve_cli_command, resolve_codex_command
from arbor_worker.provider.claude import CLAUDECODE_GUARD
from arbor_worker.provider.http_transport import redact_secret, urllib_http_request

MINUTE_MS = 60_000
HOUR_MS = 60 * MINUTE_MS
DAY_MS = 24 * HOUR_MS

SESSION_MINS = 5 * 60
WEEK_MINS = 7 * 24 * 60
MONTH_MINS = 30 * 24 * 60

WINDOW_KIND_ORDER = {"session": 0, "weekly": 1, "monthly": 2, "other": 3}

CLAUDE_WINDOWS = {
    "five_hour": {"kind": "session", "label": "Session", "window_minutes": SESSION_MINS},
    "seven_day": {"kind": "weekly", "label": "Weekly", "window_minutes": WEEK_MINS},
}

GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"
GROK_PROBE_FAILED_MESSAGE = "Grok could not read usage limits."

GROK_CREDENTIAL_KEYS = (
    "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828",
    "https://accounts.x.ai/sign-in",
)

GROK_SKIP_ENV = (
    "GROK_OIDC_ISSUER",
    "GROK_OIDC_CLIENT_ID",
    "GROK_OAUTH2_ISSUER",
    "GROK_OAUTH2_CLIENT_ID",
    "GROK_OAUTH2_PRINCIPAL_TYPE",
    "GROK_OAUTH2_PRINCIPAL_ID",
    "GROK_AUTH_PROVIDER_COMMAND",
    "GROK_LOCAL_AUTH",
    "GROK_CLI_CHAT_PROXY_BASE_URL",
    "GROK_MODELS_BASE_URL",
    "GROK_CONFIG",
    "GROK_CONFIG_PATH",
)

GROK_CONFIG_SECTION_RE = re.compile(
    r'^\s*(?:\[\[?\s*)?["\']?(?:auth|grok_com_config|endpoints)["\']?\s*[.\]=]',
    re.MULTILINE,
)

PERIOD_BOUNDARY_RE = re.compile(
    r"^(?:\d{4}|[+-]\d{6})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T"
    r"(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?|24:00(?::00(?:\.0+)?)?)"
    r"(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$"
)


def utc_now_iso() -> str:
    dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def clamp_percent(value: float) -> float:
    if not isinstance(value, (int, float)) or not float(value) == value:
        return 0.0
    if value != value:  # NaN
        return 0.0
    return max(0.0, min(100.0, float(value)))


def sort_windows(windows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        windows,
        key=lambda w: (WINDOW_KIND_ORDER.get(w["kind"], 99), w["id"]),
    )


def make_usage_limits(*, checked_at: str, windows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    normalized = []
    for window in windows:
        normalized.append(
            {
                **window,
                "used_percent": clamp_percent(window["used_percent"]),
            }
        )
    return {"checked_at": checked_at, "windows": sort_windows(normalized)}


def make_unavailable(
    *,
    checked_at: str,
    reason: str,
    message: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "checked_at": checked_at,
        "windows": [],
        "unavailable": {"reason": reason},
    }
    if message:
        payload["unavailable"]["message"] = message
    return payload


def iso_from_epoch_seconds(value: Any) -> str | None:
    if not isinstance(value, (int, float)) or not float(value) == value or value <= 0:
        return None
    dt = datetime.fromtimestamp(float(value), tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def iso_from_string(value: Any) -> str | None:
    if not value or not isinstance(value, str):
        return None
    try:
        text = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"
    except ValueError:
        return None


def _percent_from_amounts(used: Any, limit: Any) -> float | None:
    if not isinstance(used, (int, float)) or not isinstance(limit, (int, float)):
        return None
    if used < 0 or limit <= 0:
        return None
    percent = (float(used) / float(limit)) * 100
    return clamp_percent(percent) if percent == percent else None


def _read_spend_percent(rate_limits: dict[str, Any]) -> float | None:
    spend = rate_limits.get("spend")
    if isinstance(spend, dict) and spend.get("enabled") is True:
        used = spend.get("used")
        limit = spend.get("limit")
        if isinstance(used, dict) and isinstance(limit, dict):
            uc = str(used.get("currency", "")).strip()
            lc = str(limit.get("currency", "")).strip()
            if (
                uc
                and uc == lc
                and used.get("exponent") == limit.get("exponent")
            ):
                percent = _percent_from_amounts(
                    used.get("amount_minor"), limit.get("amount_minor")
                )
                if percent is not None:
                    return percent
    extra = rate_limits.get("extra_usage")
    if isinstance(extra, dict) and extra.get("is_enabled") is True:
        percent = _percent_from_amounts(extra.get("used_credits"), extra.get("monthly_limit"))
        if percent is None and isinstance(extra.get("utilization"), (int, float)):
            util = extra["utilization"]
            if util >= 0:
                return clamp_percent(float(util))
        return percent
    return None


def _read_model_scoped(rate_limits: dict[str, Any]) -> list[dict[str, Any]]:
    raw = rate_limits.get("model_scoped")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for entry in raw:
        if isinstance(entry, dict) and isinstance(entry.get("display_name"), str):
            out.append(entry)
    return out


def _scoped_window_id(display_name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", display_name.lower())
    return f"seven_day_{slug}"


def claude_usage_response_to_limits(
    *,
    response: Mapping[str, Any],
    checked_at: str,
) -> dict[str, Any]:
    if not response.get("rate_limits_available") or not response.get("rate_limits"):
        reason = "probe_failed" if response.get("rate_limits_available") else "unsupported"
        return make_unavailable(checked_at=checked_at, reason=reason)
    rate_limits = response["rate_limits"]
    if not isinstance(rate_limits, dict):
        return make_unavailable(checked_at=checked_at, reason="probe_failed")
    windows: list[dict[str, Any]] = []
    for window_id, meta in CLAUDE_WINDOWS.items():
        window = rate_limits.get(window_id)
        if not isinstance(window, dict):
            continue
        util = window.get("utilization")
        if not isinstance(util, (int, float)):
            continue
        resets = iso_from_string(window.get("resets_at"))
        entry = {
            "id": window_id,
            "kind": meta["kind"],
            "label": meta["label"],
            "used_percent": clamp_percent(float(util)),
            "window_minutes": meta["window_minutes"],
        }
        if resets:
            entry["resets_at"] = resets
        windows.append(entry)
    for entry in _read_model_scoped(rate_limits):
        util = entry.get("utilization")
        if not isinstance(util, (int, float)):
            continue
        display_name = entry["display_name"]
        resets = iso_from_string(entry.get("resets_at"))
        scoped = {
            "id": _scoped_window_id(display_name),
            "kind": "weekly",
            "label": f"Weekly · {display_name}",
            "used_percent": clamp_percent(float(util)),
            "window_minutes": WEEK_MINS,
        }
        if resets:
            scoped["resets_at"] = resets
        windows.append(scoped)
    spend = _read_spend_percent(rate_limits)
    if spend is not None:
        windows.append(
            {
                "id": "monthly_spend",
                "kind": "monthly",
                "label": "Monthly spend",
                "used_percent": spend,
            }
        )
    return make_usage_limits(checked_at=checked_at, windows=windows)


def _kind_for_duration(mins: int) -> str:
    if mins >= MONTH_MINS:
        return "monthly"
    if mins >= WEEK_MINS:
        return "weekly"
    return "session"


def _label_for_kind(kind: str) -> str:
    if kind == "session":
        return "Session"
    if kind == "weekly":
        return "Weekly"
    return "Monthly"


def codex_rate_limits_to_windows(snapshot: Mapping[str, Any]) -> list[dict[str, Any]]:
    limit_id = snapshot.get("limitId")
    if limit_id and limit_id != "codex":
        return []
    plan = snapshot.get("planType")
    is_monthly = plan in ("free", "go")
    positions = (
        ("primary", snapshot.get("primary"), MONTH_MINS if is_monthly else SESSION_MINS),
        ("secondary", snapshot.get("secondary"), WEEK_MINS),
    )
    windows: list[dict[str, Any]] = []
    for window_id, window, fallback_mins in positions:
        if not isinstance(window, dict):
            continue
        used = window.get("usedPercent")
        if not isinstance(used, (int, float)):
            continue
        duration = window.get("windowDurationMins")
        window_minutes = int(duration) if isinstance(duration, (int, float)) else fallback_mins
        kind = _kind_for_duration(window_minutes)
        resets = iso_from_epoch_seconds(window.get("resetsAt"))
        entry: dict[str, Any] = {
            "id": window_id,
            "kind": kind,
            "label": _label_for_kind(kind),
            "used_percent": clamp_percent(float(used)),
            "window_minutes": window_minutes,
        }
        if resets:
            entry["resets_at"] = resets
        windows.append(entry)
    individual = snapshot.get("individualLimit")
    if isinstance(individual, dict) and isinstance(individual.get("remainingPercent"), (int, float)):
        resets = iso_from_epoch_seconds(individual.get("resetsAt"))
        entry = {
            "id": "individual",
            "kind": "monthly",
            "label": "Monthly credit limit",
            "used_percent": clamp_percent(100 - float(individual["remainingPercent"])),
        }
        if resets:
            entry["resets_at"] = resets
        windows.append(entry)
    return windows


def codex_rate_limits_to_limits(
    *,
    snapshot: Mapping[str, Any],
    rate_limits_by_limit_id: Mapping[str, Any] | None,
    checked_at: str,
) -> dict[str, Any]:
    chosen = snapshot
    if rate_limits_by_limit_id and isinstance(rate_limits_by_limit_id.get("codex"), dict):
        chosen = rate_limits_by_limit_id["codex"]
    windows = codex_rate_limits_to_windows(chosen)
    return make_usage_limits(checked_at=checked_at, windows=windows)


def parse_period_boundary(value: str | None) -> float:
    if not value or value != value.strip() or not PERIOD_BOUNDARY_RE.match(value):
        return float("nan")
    date_part = value[: value.index("T")]
    try:
        year = int(date_part[0:4])
        month = int(date_part[5:7])
        day = int(date_part[8:10])
        datetime(year, month, day, tzinfo=timezone.utc)
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return float("nan")
    if parsed.month != int(date_part[5:7]) or parsed.day != int(date_part[8:10]):
        return float("nan")
    return parsed.timestamp() * 1000


def grok_usage_response_to_limits(response: Mapping[str, Any], checked_at: str) -> dict[str, Any]:
    config = response.get("config")
    if not isinstance(config, dict):
        return make_usage_limits(checked_at=checked_at, windows=[])
    period = config.get("currentPeriod")
    period_type = None
    if isinstance(period, dict) and isinstance(period.get("type"), str):
        period_type = period["type"].replace("USAGE_PERIOD_TYPE_", "")
    kind = (
        "weekly"
        if period_type == "WEEKLY"
        else "monthly"
        if period_type == "MONTHLY"
        else "other"
    )
    used = config.get("creditUsagePercent")
    if used is None and kind in ("weekly", "monthly") and isinstance(period, dict):
        start = period.get("start")
        end = period.get("end")
        if isinstance(start, str) and isinstance(end, str):
            if parse_period_boundary(start) < parse_period_boundary(end):
                used = 0
    if used is None or not isinstance(used, (int, float)) or used != used:
        return make_usage_limits(checked_at=checked_at, windows=[])
    label = (
        "Weekly"
        if kind == "weekly"
        else "Monthly"
        if kind == "monthly"
        else "Subscription"
    )
    window: dict[str, Any] = {
        "id": "subscription",
        "kind": kind,
        "label": label,
        "used_percent": clamp_percent(float(used)),
    }
    if isinstance(period, dict) and isinstance(period.get("end"), str):
        resets = iso_from_string(period["end"])
        if resets:
            window["resets_at"] = resets
    return make_usage_limits(checked_at=checked_at, windows=[window])


def grok_billing_http_transport(
    method: str,
    url: str,
    headers: dict[str, str] | None = None,
    timeout: float = 10,
) -> tuple[int, str, str]:
    status, body_bytes = urllib_http_request(
        method, url, headers or {}, None, float(timeout)
    )
    return status, body_bytes.decode("utf-8", errors="replace"), ""


def read_grok_credential(
    env: Mapping[str, str],
    *,
    home: os.PathLike[str] | None = None,
    read_text: Callable[[str], str] | None = None,
    system_config_paths: Iterable[os.PathLike[str]] | None = None,
) -> dict[str, Any] | None:
    if env.get("XAI_API_KEY", "").strip():
        return None
    if any(env.get(name, "").strip() for name in GROK_SKIP_ENV):
        return None

    def _read(path: str) -> str:
        if read_text is not None:
            return read_text(path)
        try:
            with open(path, encoding="utf-8") as handle:
                return handle.read()
        except OSError:
            return ""

    grok_home = env.get("GROK_HOME", "").strip()
    if grok_home:
        base = Path(grok_home)
    else:
        home_dir = Path.home() if home is None else Path(home)
        base = home_dir / ".grok"
    if system_config_paths is None:
        system_config_paths = (
            Path("/etc/grok/managed_config.toml"),
            Path("/etc/grok/requirements.toml"),
        )
    config_paths = [
        base / "config.toml",
        base / "managed_config.toml",
        base / "requirements.toml",
        *[Path(p) for p in system_config_paths],
    ]
    for config_path in config_paths:
        config = _read(str(config_path))
        if config and GROK_CONFIG_SECTION_RE.search(config):
            return None
    raw = env.get("GROK_AUTH", "").strip() or _read(str(base / "auth.json"))
    if not raw.strip():
        return None
    try:
        credentials = json.loads(raw)
    except json.JSONDecodeError:
        return {"__invalid__": True}
    if not isinstance(credentials, dict):
        return {"__invalid__": True}
    for key in GROK_CREDENTIAL_KEYS:
        entry = credentials.get(key)
        if isinstance(entry, dict):
            if entry.get("auth_mode") == "api_key":
                return None
            return entry
    return None


def read_grok_usage(
    *,
    env: Mapping[str, str] | None = None,
    home: os.PathLike[str] | None = None,
    system_config_paths: Iterable[os.PathLike[str]] | None = None,
    transport: Callable[..., tuple[int, str, str]] | None = None,
) -> dict[str, Any]:
    checked_at = utc_now_iso()
    probe_failed = make_unavailable(
        checked_at=checked_at,
        reason="probe_failed",
        message=GROK_PROBE_FAILED_MESSAGE,
    )
    environment = os.environ if env is None else env
    credential = read_grok_credential(
        environment,
        home=home,
        system_config_paths=system_config_paths,
    )
    if credential is None:
        return make_unavailable(checked_at=checked_at, reason="unsupported")
    if credential.get("__invalid__"):
        return probe_failed
    raw_key = credential.get("key")
    if not isinstance(raw_key, str) or not raw_key.strip():
        return probe_failed
    token = raw_key.strip()
    billing_transport = transport if transport is not None else grok_billing_http_transport
    try:
        status, body, _err = billing_transport(
            "GET",
            GROK_BILLING_URL,
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
    except Exception as exc:
        message = redact_secret(str(exc) or "request failed", token)
        return make_unavailable(
            checked_at=checked_at,
            reason="probe_failed",
            message=message,
        )
    if status != 200:
        return probe_failed
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return probe_failed
    if not isinstance(payload, dict):
        return probe_failed
    config = payload.get("config")
    if isinstance(config, dict):
        percent = config.get("creditUsagePercent")
        if percent is not None and (
            not isinstance(percent, (int, float)) or not math.isfinite(float(percent))
        ):
            return probe_failed
    return grok_usage_response_to_limits(payload, checked_at)


def _reap_process(proc: Any) -> None:
    if proc.stdin is not None:
        try:
            proc.stdin.close()
        except OSError:
            pass
    if proc.poll() is None:
        try:
            proc.terminate()
        except OSError:
            pass
        try:
            proc.wait(timeout=1)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
            except OSError:
                pass
            try:
                proc.wait()
            except Exception:
                pass
        except Exception:
            pass


def _start_stderr_drain(proc: Any) -> None:
    stderr = proc.stderr
    if stderr is None:
        return

    def drain() -> None:
        try:
            stderr.read()
        except (OSError, ValueError):
            pass

    threading.Thread(target=drain, daemon=True).start()


def _iter_stdout_lines(proc: Any, deadline: float):
    stdout = proc.stdout
    if stdout is None:
        return
    line_queue: queue.Queue[str | None] = queue.Queue()

    def reader() -> None:
        try:
            for line in stdout:
                line_queue.put(line)
        except (OSError, ValueError):
            pass
        finally:
            line_queue.put(None)

    threading.Thread(target=reader, daemon=True).start()
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        try:
            item = line_queue.get(timeout=min(remaining, 0.25))
        except queue.Empty:
            continue
        if item is None:
            break
        yield item


def read_claude_usage(
    *,
    popen,
    which=shutil.which,
    home: os.PathLike[str] | None = None,
    extra_dirs=None,
    timeout: float = 10,
) -> dict[str, Any]:
    checked_at = utc_now_iso()
    if os.environ.get("CLAUDECODE") == "1":
        return make_unavailable(
            checked_at=checked_at,
            reason="probe_failed",
            message=CLAUDECODE_GUARD,
        )
    cmd = resolve_cli_command("claude", which, home, extra_dirs)
    if cmd is None:
        return make_unavailable(
            checked_at=checked_at,
            reason="probe_failed",
            message="Claude CLI not found on PATH",
        )
    argv = [
        cmd,
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--input-format",
        "stream-json",
        "--no-session-persistence",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--tools",
        "",
    ]
    env = os.environ.copy()
    env["PATH"] = gui_path(home, extra_dirs=extra_dirs)
    stdin_text = (
        '{"type":"control_request","request_id":"arbor-init","request":{"subtype":"initialize"}}\n'
        '{"type":"control_request","request_id":"arbor-usage","request":{"subtype":"get_usage","skip_behaviors":true}}\n'
    )
    try:
        proc = popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
    except Exception:
        return make_unavailable(checked_at=checked_at, reason="probe_failed")

    assert proc.stdin is not None
    assert proc.stdout is not None

    def write_stdin() -> None:
        try:
            proc.stdin.write(stdin_text)
            proc.stdin.close()
        except OSError:
            pass

    threading.Thread(target=write_stdin, daemon=True).start()
    response_payload: dict[str, Any] | None = None
    deadline = time.monotonic() + timeout
    _start_stderr_drain(proc)
    try:
        for line in _iter_stdout_lines(proc, deadline):
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if message.get("type") != "control_response":
                continue
            response = message.get("response")
            if not isinstance(response, dict):
                continue
            if response.get("request_id") != "arbor-usage":
                continue
            subtype = response.get("subtype")
            if subtype == "error":
                return make_unavailable(checked_at=checked_at, reason="probe_failed")
            if subtype == "success":
                inner = response.get("response")
                if isinstance(inner, dict):
                    response_payload = inner
                break
    finally:
        _reap_process(proc)
    if response_payload is None:
        return make_unavailable(checked_at=checked_at, reason="probe_failed")
    return claude_usage_response_to_limits(response=response_payload, checked_at=checked_at)


def read_codex_usage(
    *,
    popen,
    which=shutil.which,
    home: os.PathLike[str] | None = None,
    extra_dirs=None,
    timeout: float = 10,
) -> dict[str, Any]:
    checked_at = utc_now_iso()
    cmd = resolve_codex_command(which, home, extra_dirs)
    if cmd is None:
        return make_unavailable(
            checked_at=checked_at,
            reason="probe_failed",
            message="Codex CLI not found on PATH",
        )
    argv = [cmd, "app-server"]
    env = os.environ.copy()
    env["PATH"] = gui_path(home, extra_dirs=extra_dirs)
    try:
        proc = popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
    except Exception:
        return make_unavailable(checked_at=checked_at, reason="probe_failed")
    assert proc.stdin is not None
    assert proc.stdout is not None
    init_line = json.dumps(
        {
            "id": 1,
            "method": "initialize",
            "params": {
                "clientInfo": {
                    "name": "arbor",
                    "title": "Arbor",
                    "version": __version__,
                },
                "capabilities": {
                    "experimentalApi": True,
                    "optOutNotificationMethods": None,
                },
            },
        }
    )
    rate_line = json.dumps(
        {"id": 2, "method": "account/rateLimits/read", "params": None}
    )
    init_ok = False
    rate_payload: dict[str, Any] | None = None
    deadline = time.monotonic() + timeout
    _start_stderr_drain(proc)
    try:
        proc.stdin.write(init_line + "\n")
        proc.stdin.flush()
        for line in _iter_stdout_lines(proc, deadline):
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if message.get("id") == 1:
                if message.get("error"):
                    return make_unavailable(checked_at=checked_at, reason="probe_failed")
                if message.get("result") is not None:
                    init_ok = True
                    break
        if init_ok:
            proc.stdin.write(json.dumps({"method": "initialized"}) + "\n")
            proc.stdin.write(rate_line + "\n")
            proc.stdin.flush()
            for line in _iter_stdout_lines(proc, deadline):
                line = line.strip()
                if not line:
                    continue
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if message.get("id") == 2:
                    if message.get("error"):
                        return make_unavailable(checked_at=checked_at, reason="probe_failed")
                    result = message.get("result")
                    if isinstance(result, dict):
                        rate_payload = result
                    break
    finally:
        _reap_process(proc)
    if not init_ok or rate_payload is None:
        return make_unavailable(checked_at=checked_at, reason="probe_failed")
    snapshot = rate_payload.get("rateLimits") or {}
    by_id = rate_payload.get("rateLimitsByLimitId")
    if not isinstance(snapshot, dict):
        snapshot = {}
    if not isinstance(by_id, dict):
        by_id = None
    return codex_rate_limits_to_limits(
        snapshot=snapshot,
        rate_limits_by_limit_id=by_id,
        checked_at=checked_at,
    )


def read_provider_usage(provider_id: str, **kwargs: Any) -> dict[str, Any]:
    checked_at = utc_now_iso()
    if provider_id in ("ollama", "lmstudio", "openai_api", "anthropic_api", "fake"):
        return make_unavailable(
            checked_at=checked_at,
            reason="unsupported",
            message="This provider doesn't report usage limits.",
        )
    if provider_id == "claude":
        return read_claude_usage(**kwargs)
    if provider_id == "codex":
        return read_codex_usage(**kwargs)
    if provider_id == "grok":
        return read_grok_usage(**kwargs)
    return make_unavailable(
        checked_at=checked_at,
        reason="unsupported",
        message="This provider doesn't report usage limits.",
    )

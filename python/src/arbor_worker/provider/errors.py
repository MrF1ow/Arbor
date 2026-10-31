from __future__ import annotations

import re

from arbor_worker.provider.base import ProviderError

MAX_DETAIL_LINES = 5
MAX_DETAIL_CHARS = 500

# Rust tracing: "<timestamp>  WARN <target>: ..." (level padded to five columns).
_TRACING = re.compile(r"^\d{4}-\d{2}-\d{2}T\S+\s+(ERROR|WARN|INFO|DEBUG|TRACE)\b")
# A line the CLI itself marks as an error. Codex stderr also echoes the prompt
# and transcript, so only these lines are classified, never course text.
_ERROR_LINE = re.compile(r"^(?:error\b|fatal\b|api error\b)", re.IGNORECASE)
_RATE_LIMITED = re.compile(
    r"\b429\s+too many requests\b|\btoo many requests\b"
    r"|\b(?:status|http|code)[\s:=]*429\b|\brate[- ]limit(?:ed|s)?\b",
    re.IGNORECASE,
)
# Codex prints "You've hit your usage limit." for a spent allowance. That is
# separate from a 429, which Codex retries on its own.
_QUOTA = re.compile(
    r"\bhit your usage limit\b|\busage limit (?:reached|exceeded)\b"
    r"|\binsufficient_quota\b|\bquota (?:exceeded|reached)\b|\bexceeded (?:your )?(?:current )?quota\b",
    re.IGNORECASE,
)
_AUTH = re.compile(
    r"authentication required|not authenticated|please log in|not logged in|login required",
    re.IGNORECASE,
)
_SECRETS = (
    re.compile(r"(?i)\b(authorization\s*[:=]\s*)(?:bearer\s+)?\S+"),
    re.compile(r"(?i)\b(bearer\s+)\S+"),
    re.compile(r"(?i)\b((?:api[_-]?key|access[_-]?token|token|secret|password)\s*[:=]\s*)\S+"),
    re.compile(r"()\b(?:sk|xai|sk-ant)-[A-Za-z0-9_-]{8,}"),
)

_DISPLAY = {"codex": "Codex", "claude": "Claude", "grok": "Grok"}
_PREFIX = {
    "codex": "codex exec failed",
    "claude": "claude failed",
    "grok": "grok failed",
}


def display_name(label: str) -> str:
    if label in _DISPLAY:
        return _DISPLAY[label]
    if not label:
        return "Provider"
    return label[:1].upper() + label[1:]


def prepare_cli_text(text: str) -> str:
    """Drop a trailing desktop "Worker exited" line glued onto CLI stderr.

    The provider captures the CLI's own stderr before the worker process
    exits. Rust then emits a separate ``worker_exit`` event, and the desktop
    formats that as "Worker exited". The issue log has that sentence stuck
    to the last stderr line with no newline; it is not CLI output.
    """
    normalized = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    return re.sub(r"Worker exited\s*$", "", normalized).strip()


def _lines(text: str) -> list[str]:
    return [line.strip() for line in prepare_cli_text(text).splitlines() if line.strip()]


def _level(line: str) -> str | None:
    match = _TRACING.match(line)
    return match.group(1) if match else None


def _error_lines(lines: list[str]) -> list[str]:
    return [line for line in lines if _level(line) == "ERROR" or _ERROR_LINE.match(line)]


def classify_kind(text: str) -> str:
    """Classify from the CLI's own error lines, else its last line."""
    lines = _lines(text)
    candidates = _error_lines(lines) or lines[-1:]
    joined = "\n".join(candidates)
    if _RATE_LIMITED.search(joined):
        return "rate_limited"
    if _QUOTA.search(joined):
        return "quota"
    if _AUTH.search(joined):
        return "auth"
    return "unknown"


def redact_secrets(text: str) -> str:
    for pattern in _SECRETS:
        text = pattern.sub(lambda m: f"{m.group(1)}[redacted]", text)
    return text


def clean_cli_detail(text: str) -> str:
    lines = _lines(text)
    # Prefer the CLI's error lines. Without any, keep warnings too, since a
    # warning may be the only report of the real failure.
    meaningful = _error_lines(lines) or [
        line for line in lines if _level(line) not in ("INFO", "DEBUG", "TRACE")
    ]
    deduped: list[str] = []
    seen: set[str] = set()
    for line in meaningful:
        if line in seen:
            continue
        seen.add(line)
        deduped.append(line)
    if deduped:
        chosen = deduped[-MAX_DETAIL_LINES:]
    elif lines:
        chosen = [lines[-1]]
    else:
        return ""
    detail = redact_secrets("\n".join(chosen))
    if len(detail) <= MAX_DETAIL_CHARS:
        return detail
    tail = detail[-MAX_DETAIL_CHARS:]
    newline = tail.find("\n")
    if newline != -1 and newline < len(tail) - 1:
        tail = tail[newline + 1 :]
    return tail.strip()


def summary_for(label: str, kind: str) -> str:
    display = display_name(label)
    if kind == "rate_limited":
        return (
            f"{display} is rate limited (HTTP 429) and its own retries ran out. "
            "Wait and try again."
        )
    if kind == "quota":
        return (
            f"{display} has reached its usage limit. "
            "Wait for the quota to reset and try again."
        )
    if kind == "auth":
        return f"{display} is not authenticated. Sign in and try again."
    return f"{display} failed."


def _classified(label: str, kind: str, text: str, exit_code: int | None) -> ProviderError:
    summary = summary_for(label, kind)
    detail = clean_cli_detail(text)
    message = summary if not detail else f"{summary}\n{detail}"
    return ProviderError(
        message,
        kind=kind,
        exit_code=exit_code,
        summary=summary,
        detail=detail,
    )


def _classify_message(text: str) -> str:
    # A structured provider error message is the provider's own text, not
    # echoed stderr, so the whole message is classified.
    if _RATE_LIMITED.search(text):
        return "rate_limited"
    if _QUOTA.search(text):
        return "quota"
    if _AUTH.search(text):
        return "auth"
    return "unknown"


def message_failure(
    label: str,
    message: str,
    *,
    exit_code: int | None = None,
) -> ProviderError:
    """Classify a short provider message. Unknown text is left unchanged."""
    text = redact_secrets((message or "").strip() or f"{label} error")
    kind = _classify_message(text)
    if kind == "unknown":
        return ProviderError(text, exit_code=exit_code)
    return _classified(label, kind, text, exit_code)


def cli_process_failure(label: str, exit_code: int, text: str) -> ProviderError:
    """Classify a nonzero CLI exit from combined stderr/stdout."""
    kind = classify_kind(text or "")
    if kind == "unknown":
        prefix = _PREFIX.get(label, f"{label} failed")
        shown = clean_cli_detail(text or "") or "no stderr"
        message = f"{prefix} ({exit_code}): {shown}"
        return ProviderError(
            message,
            kind="unknown",
            exit_code=exit_code,
            summary=message,
            detail=shown,
        )
    return _classified(label, kind, text or "", exit_code)


def provider_failure_event_fields(error: BaseException) -> dict[str, object]:
    current: BaseException | None = error
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, ProviderError):
            return current.event_fields()
        current = current.__cause__
    return {}

from __future__ import annotations

import re

from arbor_worker.provider.base import ProviderError

MAX_DETAIL_LINES = 5
MAX_DETAIL_CHARS = 500

# Rust tracing: "<timestamp>  WARN <target>: ..." (level padded to five columns).
_TRACING_NOISE = re.compile(r"^\d{4}-\d{2}-\d{2}T\S+\s+(?:WARN|INFO|DEBUG)\b")
_RATE_LIMITED = re.compile(
    r"(?<!\d)429(?!\d)|too many requests|rate limit|exceeded retry limit",
    re.IGNORECASE,
)
# Codex prints "You've hit your usage limit." for a spent allowance. That is
# separate from a 429, which Codex retries on its own.
_QUOTA = re.compile(r"quota|usage[- ]limit", re.IGNORECASE)
_AUTH = re.compile(
    r"authentication required|not authenticated|please log in|not logged in|login required",
    re.IGNORECASE,
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


def classify_kind(text: str) -> str:
    prepared = prepare_cli_text(text)
    if _RATE_LIMITED.search(prepared):
        return "rate_limited"
    if _QUOTA.search(prepared):
        return "quota"
    if _AUTH.search(prepared):
        return "auth"
    return "unknown"


def clean_cli_detail(text: str) -> str:
    prepared = prepare_cli_text(text)
    raw_lines = [line.strip() for line in prepared.splitlines() if line.strip()]
    meaningful = [line for line in raw_lines if not _TRACING_NOISE.match(line)]
    deduped: list[str] = []
    seen: set[str] = set()
    for line in meaningful:
        if line in seen:
            continue
        seen.add(line)
        deduped.append(line)
    if deduped:
        chosen = deduped[-MAX_DETAIL_LINES:]
    elif raw_lines:
        chosen = [raw_lines[-1]]
    else:
        return ""
    detail = "\n".join(chosen)
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


def message_failure(
    label: str,
    message: str,
    *,
    exit_code: int | None = None,
) -> ProviderError:
    """Classify a short provider message. Unknown text is left unchanged."""
    text = (message or "").strip() or f"{label} error"
    kind = classify_kind(text)
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

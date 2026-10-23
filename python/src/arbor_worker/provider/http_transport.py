from __future__ import annotations

import errno
import json
import os
import urllib.error
import urllib.request
from collections.abc import Iterator
from typing import Callable, Protocol
from urllib.parse import urlparse

from arbor_worker.provider.base import ProviderError

_BLOCKED_HOSTS = frozenset({"api.openai.com", "api.anthropic.com"})

HttpRequestFn = Callable[[str, str, dict[str, str], bytes | None, float], tuple[int, bytes]]
HttpStreamFn = Callable[
    [str, str, dict[str, str], bytes | None, float], tuple[int, Iterator[bytes]]
]


class HttpTransport(Protocol):
    def __call__(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None,
        timeout: float,
    ) -> tuple[int, bytes]: ...


def redact_secret(text: str, secret: str | None) -> str:
    if not secret:
        return text
    return text.replace(secret, "[redacted]")


def is_connection_refused(exc: BaseException) -> bool:
    if isinstance(exc, ConnectionRefusedError):
        return True
    if isinstance(exc, OSError) and getattr(exc, "errno", None) == errno.ECONNREFUSED:
        return True
    if isinstance(exc, urllib.error.URLError):
        reason = exc.reason
        if isinstance(reason, ConnectionRefusedError):
            return True
        if isinstance(reason, OSError) and getattr(reason, "errno", None) == errno.ECONNREFUSED:
            return True
    msg = str(exc)
    return "Connection refused" in msg or "ECONNREFUSED" in msg


def _check_remote_allowed(url: str) -> None:
    host = (urlparse(url).hostname or "").lower()
    if host in _BLOCKED_HOSTS and os.environ.get("ARBOR_ALLOW_REMOTE_API") != "1":
        raise ProviderError(
            f"HTTP requests to {host} are blocked; set ARBOR_ALLOW_REMOTE_API=1 to allow"
        )


class _NoRedirectHTTPRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _http_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(_NoRedirectHTTPRedirectHandler())


def urllib_http_stream(
    method: str,
    url: str,
    headers: dict[str, str],
    body: bytes | None,
    timeout: float,
) -> tuple[int, Iterator[bytes]]:
    _check_remote_allowed(url)
    req = urllib.request.Request(url, data=body, headers=headers, method=method.upper())
    opener = _http_opener()
    try:
        resp = opener.open(req, timeout=timeout)
    except urllib.error.HTTPError as exc:
        try:
            err_body = exc.read()
        finally:
            exc.close()

        def err_iter() -> Iterator[bytes]:
            yield err_body

        return exc.code, err_iter()
    except urllib.error.URLError as exc:
        if is_connection_refused(exc):
            raise ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused") from exc
        raise

    status = resp.status

    def body_iter() -> Iterator[bytes]:
        try:
            while True:
                chunk = resp.readline()
                if not chunk:
                    break
                yield chunk
        finally:
            resp.close()

    return status, body_iter()


def urllib_http_request(
    method: str,
    url: str,
    headers: dict[str, str],
    body: bytes | None,
    timeout: float,
) -> tuple[int, bytes]:
    _check_remote_allowed(url)
    req = urllib.request.Request(url, data=body, headers=headers, method=method.upper())
    opener = _http_opener()
    try:
        with opener.open(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read()
        finally:
            exc.close()
        return exc.code, body
    except urllib.error.URLError as exc:
        if is_connection_refused(exc):
            raise ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused") from exc
        raise


def error_excerpt(status: int, body: bytes, secret: str | None, max_len: int = 200) -> str:
    text = body.decode("utf-8", errors="replace")
    text = redact_secret(text, secret)
    if len(text) > max_len:
        text = text[:max_len] + "…"
    return f"HTTP {status}: {text}"


def parse_json_body(body: bytes, malformed_message: str) -> dict:
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise ProviderError(malformed_message)
    if not isinstance(payload, dict):
        raise ProviderError(malformed_message)
    return payload


def strip_trailing_slash(base: str) -> str:
    return base.rstrip("/")

"""Count every provider call in this machine's local provider_calls.jsonl.

`make_provider` wraps each provider it builds, so jobs, chat and the serve pool are all
counted at that one seam. A failed call is logged too (tokens null): the log counts
requests, and a request that errored still reached, or tried to reach, the provider.
Logging is best effort: any error while writing is swallowed and never fails the call.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from arbor_worker.provider.base import ProviderRequest, ProviderResult


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class UsageLoggingProvider:
    """Forwards everything to `inner`; `run` (and `stream`, when it has one) also log."""

    def __init__(self, inner, root: Path, source: str) -> None:
        self._inner = inner
        self._root = Path(root)
        self._source = source
        self._log_path: Path | None = None
        # Defined per instance, only when the inner provider streams, so that
        # supports_stream(wrapper) == supports_stream(inner).
        if callable(getattr(inner, "stream", None)):
            self.stream = self._stream  # type: ignore[method-assign]

    def __getattr__(self, name: str):
        # Only reached for attributes the wrapper does not define itself.
        if name == "_inner":
            raise AttributeError(name)
        return getattr(self._inner, name)

    def run(self, request: ProviderRequest) -> ProviderResult:
        result: ProviderResult | None = None
        try:
            result = self._inner.run(request)
            return result
        finally:
            self._log(request, result)

    def _stream(self, request: ProviderRequest, on_delta) -> ProviderResult:
        result: ProviderResult | None = None
        try:
            result = self._inner.stream(request, on_delta)
            return result
        finally:
            self._log(request, result)

    def _log(self, request: ProviderRequest, result: ProviderResult | None) -> None:
        try:
            from arbor_worker.machine import append_provider_call, provider_calls_path

            if self._log_path is None:
                self._log_path = provider_calls_path(self._root)
            append_provider_call(
                self._root,
                {
                    "ts": _now_iso(),
                    "provider": getattr(self._inner, "name", "unknown"),
                    "model": request.model_id,
                    "input_tokens": getattr(result, "input_tokens", None),
                    "output_tokens": getattr(result, "output_tokens", None),
                    "source": self._source,
                },
                self._log_path,
            )
        except Exception:
            pass


def with_usage_log(inner, root: Path, source: str):
    return UsageLoggingProvider(inner, root, source)

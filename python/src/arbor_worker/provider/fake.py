from __future__ import annotations

import os
import threading
import time
from collections.abc import Callable

from arbor_worker.provider.base import (
    Model,
    ProviderError,
    ProviderRequest,
    ProviderResult,
    ProviderStatus,
)
from arbor_worker.provider.errors import ProviderCancelled

DEFAULT_FAKE_MARKDOWN = (
    "# Lecture\n## Overview\nThis is a fake digest overview long enough to validate.\n"
    "## Key Concepts\n- concept\n## Important Details\n- detail\n"
    "## Questions to Review\n- question?\n"
)

# A blocked call gives up after this long if nobody cancels it.
BLOCK_LIMIT_SECONDS = 60.0
BLOCK_POLL_SECONDS = 0.02


class FakeProvider:
    name = "fake"

    def __init__(
        self,
        markdown: str,
        models: list[Model] | None = None,
        available: bool = True,
        stream_script: list[str] | None = None,
        block_when: Callable[[ProviderRequest], bool] | None = None,
    ):
        self._markdown = markdown
        self._models = models or [Model("fake-model", "Fake Model")]
        self._available = available
        self.calls: list[ProviderRequest] = []
        # A request for which block_when is true hangs, like a long provider call,
        # until its cancel_check turns true (then ProviderCancelled). `blocked` is
        # set when the first such call starts waiting.
        # ARBOR_FAKE_BLOCK_ON=<text> blocks every prompt containing <text>, so the
        # worker CLI can be driven through a cancel without a real provider.
        needle = os.environ.get("ARBOR_FAKE_BLOCK_ON")
        if block_when is None and needle:
            block_when = lambda request: needle in request.prompt  # noqa: E731
        self._block_when = block_when
        self.blocked = threading.Event()
        if stream_script is not None:
            script = list(stream_script)

            def stream(request: ProviderRequest, on_delta) -> ProviderResult:
                self.calls.append(request)
                parts: list[str] = []
                for chunk in script:
                    on_delta(chunk)
                    parts.append(chunk)
                return ProviderResult(markdown="".join(parts))

            self.stream = stream  # type: ignore[method-assign]

    def status(self) -> ProviderStatus:
        if self._available:
            return ProviderStatus(True, "")
        return ProviderStatus(False, "Fake provider unavailable")

    def is_available(self) -> bool:
        return self.status().available

    def list_models(self) -> list[Model]:
        return list(self._models)

    def run(self, request: ProviderRequest) -> ProviderResult:
        self.calls.append(request)
        if self._block_when is not None and self._block_when(request):
            self._block(request)
        return ProviderResult(markdown=self._markdown)

    def _block(self, request: ProviderRequest) -> None:
        self.blocked.set()
        deadline = time.monotonic() + BLOCK_LIMIT_SECONDS
        while time.monotonic() < deadline:
            if request.cancel_check is not None and request.cancel_check():
                raise ProviderCancelled()
            time.sleep(BLOCK_POLL_SECONDS)
        raise ProviderError("fake provider stayed blocked and was never cancelled")

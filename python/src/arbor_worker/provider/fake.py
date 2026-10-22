from __future__ import annotations

from arbor_worker.provider.base import Model, ProviderRequest, ProviderResult, ProviderStatus

DEFAULT_FAKE_MARKDOWN = (
    "# Lecture\n## Overview\nThis is a fake digest overview long enough to validate.\n"
    "## Key Concepts\n- concept\n## Important Details\n- detail\n"
    "## Questions to Review\n- question?\n"
)


class FakeProvider:
    name = "fake"

    def __init__(
        self,
        markdown: str,
        models: list[Model] | None = None,
        available: bool = True,
        stream_script: list[str] | None = None,
    ):
        self._markdown = markdown
        self._models = models or [Model("fake-model", "Fake Model")]
        self._available = available
        self.calls: list[ProviderRequest] = []
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
        return ProviderResult(markdown=self._markdown)

from __future__ import annotations

from arbor_worker.provider.base import Model, ProviderRequest, ProviderResult


class FakeProvider:
    name = "fake"

    def __init__(self, markdown: str, models: list[Model] | None = None, available: bool = True):
        self._markdown = markdown
        self._models = models or [Model("fake-model", "Fake Model")]
        self._available = available
        self.calls: list[ProviderRequest] = []

    def is_available(self) -> bool:
        return self._available

    def list_models(self) -> list[Model]:
        return list(self._models)

    def run(self, request: ProviderRequest) -> ProviderResult:
        self.calls.append(request)
        return ProviderResult(markdown=self._markdown)

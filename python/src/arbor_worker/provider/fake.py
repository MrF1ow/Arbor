from __future__ import annotations

import re

from arbor_worker.provider.base import Model, ProviderRequest, ProviderResult

_MARKER_RE = re.compile(r"arbor-pages:(\d+)-(\d+)")


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
        markdown = self._wrap_markers(request.prompt, self._markdown)
        return ProviderResult(markdown=markdown)

    def _wrap_markers(self, prompt: str, markdown: str) -> str:
        if "arbor-pages:" in markdown:
            return markdown
        if "Page markers:" not in prompt:
            return markdown
        match = _MARKER_RE.search(prompt)
        if match is None:
            return markdown
        body = markdown if markdown.endswith("\n") else markdown + "\n"
        start, end = match.group(1), match.group(2)
        return (
            f"<!-- arbor-pages:{start}-{end} -->\n"
            f"{body.rstrip()}\n"
            f"<!-- /arbor-pages:{start}-{end} -->\n"
        )

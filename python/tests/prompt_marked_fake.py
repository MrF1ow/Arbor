from __future__ import annotations

import re

from arbor_worker.provider.base import ProviderRequest, ProviderResult
from arbor_worker.provider.fake import FakeProvider

_MARKER_RE = re.compile(r"arbor-pages:(\d+)-(\d+)")


def _wrap_markers(prompt: str, markdown: str) -> str:
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


class PromptMarkedFake(FakeProvider):
    def run(self, request: ProviderRequest) -> ProviderResult:
        result = super().run(request)
        return ProviderResult(markdown=_wrap_markers(request.prompt, result.markdown))

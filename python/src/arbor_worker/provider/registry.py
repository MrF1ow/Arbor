from __future__ import annotations

from dataclasses import dataclass

from arbor_worker.provider.base import Model, ProviderError
from arbor_worker.provider.claude import CLAUDE_DOCS_URL, DEFAULT_CLAUDE_MODELS, ClaudeCliProvider
from arbor_worker.provider.codex import CodexCliProvider
from arbor_worker.provider.fake import DEFAULT_FAKE_MARKDOWN, FakeProvider
from arbor_worker.provider.grok import DEFAULT_GROK_MODELS, GROK_DOCS_URL, GrokCliProvider
from arbor_worker.settings import DEFAULT_MODELS, DOCS_URL


@dataclass(frozen=True)
class ProviderEntry:
    cls: type
    label: str
    docs_url: str
    default_models: list[Model]


PROVIDER_ORDER = ("codex", "claude", "grok", "fake")

PROVIDERS: dict[str, ProviderEntry] = {
    "codex": ProviderEntry(
        cls=CodexCliProvider,
        label="Codex",
        docs_url=DOCS_URL,
        default_models=list(DEFAULT_MODELS),
    ),
    "claude": ProviderEntry(
        cls=ClaudeCliProvider,
        label="Claude",
        docs_url=CLAUDE_DOCS_URL,
        default_models=list(DEFAULT_CLAUDE_MODELS),
    ),
    "grok": ProviderEntry(
        cls=GrokCliProvider,
        label="Grok",
        docs_url=GROK_DOCS_URL,
        default_models=list(DEFAULT_GROK_MODELS),
    ),
    "fake": ProviderEntry(
        cls=FakeProvider,
        label="Fake",
        docs_url="",
        default_models=[Model("fake-model", "Fake Model")],
    ),
}


def provider_choices() -> list[str]:
    return list(PROVIDER_ORDER)


def make_provider(
    name: str,
    root,
    runner=None,
    which=None,
    *,
    fake_markdown: str | None = None,
):
    from arbor_worker.settings import load_models

    if name not in PROVIDERS:
        raise ProviderError(f"unknown provider: {name!r}")
    entry = PROVIDERS[name]
    models = load_models(root, name)
    if name == "fake":
        import os

        markdown = fake_markdown
        if markdown is None:
            markdown = os.environ.get("ARBOR_FAKE_MD", DEFAULT_FAKE_MARKDOWN)
        return FakeProvider(markdown=markdown, models=models)
    kwargs: dict = {"models": models}
    if runner is not None:
        kwargs["runner"] = runner
    if which is not None:
        kwargs["which"] = which
    return entry.cls(**kwargs)

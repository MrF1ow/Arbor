from pathlib import Path

from arbor_worker.provider.base import ProviderRequest, ProviderResult, Model
from arbor_worker.provider.fake import FakeProvider


def test_fake_records_calls_and_returns_markdown():
    p = FakeProvider(markdown="# T\n## Overview\nx")
    req = ProviderRequest(prompt="do it", model_id="m", image_paths=[Path("a.png")], cwd=Path("."))
    res = p.run(req)
    assert isinstance(res, ProviderResult)
    assert res.markdown.startswith("# T")
    assert p.calls == [req]


def test_fake_returns_unmarked_markdown_when_prompt_asks_for_page_markers():
    p = FakeProvider(markdown="# T\n## Overview\nx")
    prompt = (
        "Page markers:\n"
        "<!-- arbor-pages:1-2 -->\n"
        "...all notes for this window...\n"
        "<!-- /arbor-pages:1-2 -->\n"
    )
    req = ProviderRequest(prompt=prompt, model_id="m", image_paths=[], cwd=Path("."))
    res = p.run(req)
    assert "arbor-pages:" not in res.markdown
    assert res.markdown == "# T\n## Overview\nx"


def test_fake_models_and_availability():
    p = FakeProvider(markdown="x", models=[Model("id", "Label")], available=False)
    assert p.is_available() is False
    assert p.list_models() == [Model("id", "Label")]
    assert p.name == "fake"

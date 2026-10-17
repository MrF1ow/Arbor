import json
from pathlib import Path

import pytest

from arbor_worker.cli import build_parser
from arbor_worker.provider.base import ProviderError
from arbor_worker.provider.registry import PROVIDERS, make_provider, provider_choices


def test_provider_choices():
    assert provider_choices() == ["codex", "claude", "grok", "fake"]


def test_make_provider_unknown():
    with pytest.raises(ProviderError):
        make_provider("unknown", Path("."))


def test_cli_provider_choices_on_update():
    parser = build_parser()
    update_parser = next(
        action.choices["update"]
        for action in parser._actions
        if getattr(action, "choices", None) and "update" in action.choices
    )
    provider_action = next(
        a for a in update_parser._actions if getattr(a, "dest", None) == "provider"
    )
    assert set(provider_action.choices) == set(PROVIDERS.keys())


def test_list_providers_shape(tmp_path: Path, monkeypatch):
    from arbor_worker import cli

    monkeypatch.setattr(
        "arbor_worker.provider.codex.CodexCliProvider.status",
        lambda self: __import__(
            "arbor_worker.provider.base", fromlist=["ProviderStatus"]
        ).ProviderStatus(True, ""),
    )
    monkeypatch.setattr(
        "arbor_worker.provider.claude.ClaudeCliProvider.status",
        lambda self: __import__(
            "arbor_worker.provider.base", fromlist=["ProviderStatus"]
        ).ProviderStatus(False, "Claude CLI not found on PATH"),
    )
    monkeypatch.setattr(
        "arbor_worker.provider.grok.GrokCliProvider.status",
        lambda self: __import__(
            "arbor_worker.provider.base", fromlist=["ProviderStatus"]
        ).ProviderStatus(False, "Grok CLI not found on PATH"),
    )

    import io
    import contextlib

    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = cli.main(["list-providers", "--root", str(tmp_path)])
    assert code == 0
    data = json.loads(out.getvalue())
    assert [item["id"] for item in data] == ["codex", "claude", "grok", "fake"]
    for item in data:
        assert {"id", "label", "available", "reason", "docs_url", "models"} <= set(item.keys())
        assert all({"id", "label"} <= set(m.keys()) for m in item["models"])

import json
from pathlib import Path

import pytest

from arbor_worker.cli import build_parser
from arbor_worker.provider.base import ProviderError
from arbor_worker.provider.registry import PROVIDERS, make_provider, provider_choices


def test_provider_choices():
    assert provider_choices() == [
        "codex",
        "claude",
        "grok",
        "ollama",
        "lmstudio",
        "openai_api",
        "anthropic_api",
        "fake",
    ]


def test_cli_provider_is_provider_alias():
    from arbor_worker.provider.base import CliProvider, Provider

    assert CliProvider is Provider


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
    monkeypatch.setattr(
        "arbor_worker.provider.ollama.OllamaProvider.status",
        lambda self: __import__(
            "arbor_worker.provider.base", fromlist=["ProviderStatus"]
        ).ProviderStatus(False, "Ollama is not running at http://127.0.0.1:11434"),
    )
    monkeypatch.setattr(
        "arbor_worker.provider.ollama.OllamaProvider.list_models",
        lambda self: [],
    )
    monkeypatch.setattr(
        "arbor_worker.provider.lmstudio.LmStudioProvider.status",
        lambda self: __import__(
            "arbor_worker.provider.base", fromlist=["ProviderStatus"]
        ).ProviderStatus(False, "LM Studio is not running at http://127.0.0.1:1234/v1"),
    )
    monkeypatch.setattr(
        "arbor_worker.provider.lmstudio.LmStudioProvider.list_models",
        lambda self: [],
    )
    monkeypatch.setattr(
        "arbor_worker.provider.openai_api.OpenAiApiProvider.status",
        lambda self: __import__(
            "arbor_worker.provider.base", fromlist=["ProviderStatus"]
        ).ProviderStatus(False, "key missing"),
    )
    monkeypatch.setattr(
        "arbor_worker.provider.anthropic_api.AnthropicApiProvider.status",
        lambda self: __import__(
            "arbor_worker.provider.base", fromlist=["ProviderStatus"]
        ).ProviderStatus(False, "key missing"),
    )

    import io
    import contextlib

    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = cli.main(["list-providers", "--root", str(tmp_path)])
    assert code == 0
    data = json.loads(out.getvalue())
    assert [item["id"] for item in data] == [
        "codex",
        "claude",
        "grok",
        "ollama",
        "lmstudio",
        "openai_api",
        "anthropic_api",
        "fake",
    ]
    for item in data:
        assert {"id", "label", "available", "reason", "docs_url", "models"} <= set(item.keys())
        assert all({"id", "label"} <= set(m.keys()) for m in item["models"])


FAKE_TEST_API_KEY = "sk-test-arbor-not-a-real-key"


def test_list_providers_stdout_redacts_api_keys(tmp_path: Path, monkeypatch):
    from arbor_worker import cli

    monkeypatch.setenv("ARBOR_OPENAI_API_KEY", FAKE_TEST_API_KEY)
    monkeypatch.setenv("ARBOR_ANTHROPIC_API_KEY", FAKE_TEST_API_KEY)

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
    monkeypatch.setattr(
        "arbor_worker.provider.ollama.OllamaProvider.status",
        lambda self: __import__(
            "arbor_worker.provider.base", fromlist=["ProviderStatus"]
        ).ProviderStatus(False, "stub not running"),
    )
    monkeypatch.setattr(
        "arbor_worker.provider.ollama.OllamaProvider.list_models",
        lambda self: [],
    )
    monkeypatch.setattr(
        "arbor_worker.provider.lmstudio.LmStudioProvider.status",
        lambda self: __import__(
            "arbor_worker.provider.base", fromlist=["ProviderStatus"]
        ).ProviderStatus(False, "stub not running"),
    )
    monkeypatch.setattr(
        "arbor_worker.provider.lmstudio.LmStudioProvider.list_models",
        lambda self: [],
    )
    monkeypatch.setattr(
        "arbor_worker.provider.openai_api.OpenAiApiProvider.status",
        lambda self: __import__(
            "arbor_worker.provider.base", fromlist=["ProviderStatus"]
        ).ProviderStatus(True, ""),
    )
    monkeypatch.setattr(
        "arbor_worker.provider.anthropic_api.AnthropicApiProvider.status",
        lambda self: __import__(
            "arbor_worker.provider.base", fromlist=["ProviderStatus"]
        ).ProviderStatus(True, ""),
    )

    import contextlib
    import io

    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = cli.main(["list-providers", "--root", str(tmp_path)])
    assert code == 0
    text = out.getvalue()
    assert FAKE_TEST_API_KEY not in text

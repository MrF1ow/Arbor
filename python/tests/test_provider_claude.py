import json
from pathlib import Path

import pytest

from arbor_worker.provider.base import Model, ProviderRequest, ProviderStatus
from arbor_worker.provider.claude import (
    CLAUDECODE_GUARD,
    ClaudeCliProvider,
)
from arbor_worker.auth import gui_path
from arbor_worker.provider.base import ProviderError

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "providers"


def test_build_argv_text(tmp_path: Path):
    prov = ClaudeCliProvider(models=[Model("m", "M")], which=lambda name: "/usr/bin/claude")
    req = ProviderRequest(prompt="hello", model_id="claude-sonnet-5-5", cwd=tmp_path)
    argv = prov.build_argv(req)
    assert argv[:3] == ["/usr/bin/claude", "-p", "--model"]
    assert "claude-sonnet-5-5" in argv
    assert "--output-format" in argv and "json" in argv
    assert argv.count("--tools") == 1
    assert "--no-session-persistence" in argv
    assert "--input-format" not in argv


def test_build_argv_image(tmp_path: Path):
    img = tmp_path / "scan.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n")
    prov = ClaudeCliProvider(models=[Model("m", "M")], which=lambda name: "/bin/claude")
    req = ProviderRequest(
        prompt="describe",
        model_id="claude-sonnet-5-5",
        image_paths=[img],
        cwd=tmp_path,
    )
    argv = prov.build_argv(req)
    assert "--input-format" in argv
    assert argv[argv.index("--input-format") + 1] == "stream-json"
    payload = prov._stdin_payload(req)
    data = json.loads(payload.strip())
    assert data["message"]["content"][0]["text"] == "describe"
    assert data["message"]["content"][1]["source"]["media_type"] == "image/png"


def test_run_parses_fixture(tmp_path: Path):
    fixture_stdout = (FIXTURES / "claude-result.json").read_text()

    def runner(argv, **kwargs):
        assert kwargs["input"] == "prompt text"
        assert kwargs["cwd"] == tmp_path

        class R:
            returncode = 0
            stdout = fixture_stdout
            stderr = ""

        return R()

    prov = ClaudeCliProvider(models=[Model("m", "M")], runner=runner)
    res = prov.run(
        ProviderRequest(prompt="prompt text", model_id="m", cwd=tmp_path),
    )
    assert "Fixture markdown" in res.markdown


def test_run_raises_on_is_error(tmp_path: Path):
    fixture_stdout = (FIXTURES / "claude-error.json").read_text()

    def runner(argv, **kwargs):
        class R:
            returncode = 0
            stdout = fixture_stdout
            stderr = ""

        return R()

    prov = ClaudeCliProvider(models=[Model("m", "M")], runner=runner)
    with pytest.raises(ProviderError, match="Authentication"):
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))


def test_claude_guard_blocks_run(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("CLAUDECODE", "1")
    prov = ClaudeCliProvider(models=[Model("m", "M")], runner=lambda *a, **k: None)
    assert prov.is_available() is False
    assert prov.status() == ProviderStatus(False, CLAUDECODE_GUARD)
    with pytest.raises(ProviderError, match=CLAUDECODE_GUARD):
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))


def test_claude_guard_off_uses_runner(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("CLAUDECODE", raising=False)
    called = {}

    def runner(argv, **kwargs):
        called["yes"] = True

        class R:
            returncode = 0
            stdout = (FIXTURES / "claude-result.json").read_text()
            stderr = ""

        return R()

    prov = ClaudeCliProvider(models=[Model("m", "M")], runner=runner)
    prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))
    assert called.get("yes")


def test_run_passes_gui_path_env(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("CLAUDECODE", raising=False)
    expected_path = gui_path()
    captured = {}

    def runner(argv, **kwargs):
        captured["env"] = kwargs.get("env")

        class R:
            returncode = 0
            stdout = (FIXTURES / "claude-result.json").read_text()
            stderr = ""

        return R()

    prov = ClaudeCliProvider(
        models=[Model("m", "M")],
        runner=runner,
        which=lambda name: "/usr/bin/claude",
    )
    prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))
    assert captured["env"] is not None
    assert captured["env"]["PATH"] == expected_path


def test_run_raises_when_cli_missing(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("CLAUDECODE", raising=False)
    monkeypatch.setattr("arbor_worker.auth.Path.home", lambda: tmp_path)

    def runner(*args, **kwargs):
        raise AssertionError("runner must not be called")

    prov = ClaudeCliProvider(
        models=[Model("m", "M")],
        runner=runner,
        which=lambda name: None,
    )
    with pytest.raises(ProviderError, match="Claude CLI not found on PATH"):
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))


def test_auth_success():
    prov = ClaudeCliProvider(
        models=[Model("m", "M")],
        which=lambda name: "/usr/bin/claude",
        runner=lambda *a, **k: type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})(),
    )
    assert prov.is_available() is True


def test_auth_failure():
    prov = ClaudeCliProvider(
        models=[Model("m", "M")],
        which=lambda name: "/usr/bin/claude",
        runner=lambda *a, **k: type("R", (), {"returncode": 1, "stdout": "nope", "stderr": ""})(),
    )
    assert prov.is_available() is False


def test_auth_timeout():
    import subprocess

    def runner(*a, **k):
        raise subprocess.TimeoutExpired(cmd="claude", timeout=10)

    prov = ClaudeCliProvider(
        models=[Model("m", "M")],
        which=lambda name: "/usr/bin/claude",
        runner=runner,
    )
    assert prov.is_available() is False
    assert "timeout" in prov.status().reason.lower()

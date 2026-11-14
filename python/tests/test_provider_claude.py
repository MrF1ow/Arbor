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


@pytest.fixture(autouse=True)
def _no_claudecode(monkeypatch):
    # Tests must not depend on whether the suite runs inside a Claude Code session.
    monkeypatch.delenv("CLAUDECODE", raising=False)


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
    assert argv[argv.index("--output-format") + 1] == "json"
    assert "--verbose" not in argv


def test_build_argv_system_prompt(tmp_path: Path):
    prov = ClaudeCliProvider(models=[Model("m", "M")], which=lambda name: "/usr/bin/claude")
    req = ProviderRequest(
        prompt="hello",
        model_id="claude-sonnet-5-5",
        cwd=tmp_path,
        system="System text here.",
    )
    argv = prov.build_argv(req)
    idx = argv.index("--system-prompt")
    assert argv[idx + 1] == "System text here."


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
    assert argv[argv.index("--input-format") + 1] == "stream-json"
    # The CLI rejects --input-format stream-json unless the output is stream-json too.
    assert argv[argv.index("--output-format") + 1] == "stream-json"
    assert argv.count("--verbose") == 1
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

    prov = ClaudeCliProvider(models=[Model("m", "M")], runner=runner, which=lambda name: "/usr/bin/claude")
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

    prov = ClaudeCliProvider(models=[Model("m", "M")], runner=runner, which=lambda name: "/usr/bin/claude")
    with pytest.raises(ProviderError, match="Authentication") as exc:
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))
    assert exc.value.kind == "auth"


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

    prov = ClaudeCliProvider(models=[Model("m", "M")], runner=runner, which=lambda name: "/usr/bin/claude")
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


def _image_request(tmp_path: Path) -> ProviderRequest:
    img = tmp_path / "page.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n")
    return ProviderRequest(
        prompt="describe", model_id="claude-sonnet-5-5", image_paths=[img], cwd=tmp_path
    )


def _provider(runner) -> ClaudeCliProvider:
    return ClaudeCliProvider(
        models=[Model("m", "M")], runner=runner, which=lambda name: "/usr/bin/claude"
    )


def _completed(returncode: int, stdout: str = "", stderr: str = ""):
    class R:
        pass

    r = R()
    r.returncode = returncode
    r.stdout = stdout
    r.stderr = stderr
    return r


def test_build_stream_argv_with_images_has_one_verbose(tmp_path: Path):
    prov = _provider(lambda *a, **k: None)
    argv = prov.build_stream_argv(_image_request(tmp_path))
    assert argv.count("--verbose") == 1
    assert argv.count("--include-partial-messages") == 1
    assert argv[argv.index("--output-format") + 1] == "stream-json"


def test_run_with_images_reads_the_stream_result(tmp_path: Path):
    stream = (FIXTURES / "claude-stream-result.jsonl").read_text()
    seen = {}

    def runner(argv, **kwargs):
        seen["argv"] = argv
        return _completed(0, stdout=stream)

    res = _provider(runner).run(_image_request(tmp_path))
    assert res.markdown == "Red."
    assert res.input_tokens == 2
    assert res.output_tokens == 5
    assert seen["argv"][seen["argv"].index("--output-format") + 1] == "stream-json"


def test_run_with_images_auth_error_stream_exits_1(tmp_path: Path):
    # The real CLI exits 1 with an is_error result event on stdout.
    stream = (FIXTURES / "claude-stream-auth-error.jsonl").read_text()
    prov = _provider(lambda *a, **k: _completed(1, stdout=stream))
    with pytest.raises(ProviderError) as exc:
        prov.run(_image_request(tmp_path))
    assert exc.value.kind == "auth"
    assert "Not logged in · Please run /login" in str(exc.value)
    assert "{" not in str(exc.value)


def test_run_with_images_model_error_stream_keeps_cli_text(tmp_path: Path):
    stream = (FIXTURES / "claude-stream-model-error.jsonl").read_text()
    prov = _provider(lambda *a, **k: _completed(1, stdout=stream))
    with pytest.raises(ProviderError) as exc:
        prov.run(_image_request(tmp_path))
    assert "There's an issue with the selected model" in str(exc.value)
    assert "{" not in str(exc.value)


def test_run_with_images_argument_rejection_is_cli_usage(tmp_path: Path):
    stderr = "Error: --input-format=stream-json requires output-format=stream-json.\n"
    prov = _provider(lambda *a, **k: _completed(1, stdout="", stderr=stderr))
    with pytest.raises(ProviderError) as exc:
        prov.run(_image_request(tmp_path))
    assert exc.value.kind == "cli_usage"
    assert exc.value.summary == (
        "Claude rejected Arbor's command-line arguments. Update the claude CLI or Arbor."
    )
    assert "requires output-format=stream-json" in str(exc.value)


def test_run_with_images_empty_stream_exit_0_is_empty_result(tmp_path: Path):
    prov = _provider(lambda *a, **k: _completed(0, stdout=""))
    with pytest.raises(ProviderError, match="claude returned empty result"):
        prov.run(_image_request(tmp_path))


def test_run_with_images_survives_a_cli_that_validates_its_flags(tmp_path: Path):
    """Mirrors the real CLI: stream-json input needs stream-json output."""
    stream = (FIXTURES / "claude-stream-result.jsonl").read_text()

    def strict_cli(argv, **kwargs):
        if "--input-format" in argv and argv[argv.index("--input-format") + 1] == "stream-json":
            fmt = argv[argv.index("--output-format") + 1] if "--output-format" in argv else "text"
            if fmt != "stream-json":
                return _completed(
                    1, stderr="Error: --input-format=stream-json requires output-format=stream-json.\n"
                )
            return _completed(0, stdout=stream)
        return _completed(0, stdout=(FIXTURES / "claude-result.json").read_text())

    prov = _provider(strict_cli)
    assert prov.run(_image_request(tmp_path)).markdown == "Red."
    assert "Fixture markdown" in prov.run(
        ProviderRequest(prompt="p", model_id="m", cwd=tmp_path)
    ).markdown

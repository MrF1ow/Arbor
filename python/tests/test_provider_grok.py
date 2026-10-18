import json
from pathlib import Path

import pytest

from arbor_worker.provider.base import Model, ProviderRequest, ProviderError
from arbor_worker.provider.grok import GrokCliProvider, GROK_DISALLOWED_TOOLS

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "providers"


def test_build_argv_text_uses_prompt_file(tmp_path: Path):
    prov = GrokCliProvider(models=[Model("m", "M")], which=lambda name: "/usr/bin/grok")
    req = ProviderRequest(prompt="digest this", model_id="grok-4.7", cwd=tmp_path)
    prompt_file = tmp_path / "prompt.txt"
    prompt_file.write_text("digest this")
    argv = prov.build_argv(req, prompt_file=prompt_file)
    assert argv[0] == "/usr/bin/grok"
    assert argv[1:3] == ["--prompt-file", str(prompt_file)]
    assert "-m" in argv and "grok-4.7" in argv
    assert "--disable-web-search" in argv
    assert "--no-subagents" in argv
    assert "--no-plan" in argv
    assert "--max-turns" in argv and "1" in argv
    assert "--permission-mode" in argv and "dontAsk" in argv
    assert "--cwd" in argv and str(tmp_path) in argv
    assert "--verbatim" in argv
    assert "--disallowed-tools" in argv
    assert GROK_DISALLOWED_TOOLS in argv
    assert "--sandbox" not in argv
    assert "-p" not in argv
    assert "--tools" not in argv


def test_grok_disallowed_tools_list():
    expected = [
        "run_terminal_cmd",
        "write",
        "search_replace",
        "task",
        "web_search",
        "web_fetch",
        "read_file",
        "grep",
        "list_dir",
        "todo_write",
        "monitor",
        "search_tool",
        "use_tool",
        "workflow",
        "enter_plan_mode",
        "exit_plan_mode",
        "ask_user_question",
        "send_feedback",
        "image_gen",
        "image_edit",
        "image_to_video",
        "reference_to_video",
    ]
    assert GROK_DISALLOWED_TOOLS.split(",") == expected


def test_build_argv_image_uses_prompt_file(tmp_path: Path):
    img = tmp_path / "page.jpg"
    img.write_bytes(b"\xff\xd8\xff")
    prov = GrokCliProvider(models=[Model("m", "M")], which=lambda name: "/bin/grok")
    req = ProviderRequest(
        prompt="look",
        model_id="grok-4.7",
        image_paths=[img],
        cwd=tmp_path,
    )
    prompt_file = tmp_path / "blocks.json"
    blocks = [
        {"type": "text", "text": "look"},
        {"type": "image", "mimeType": "image/jpeg", "data": "f/9/"},
    ]
    prompt_file.write_text(json.dumps(blocks))
    argv = prov.build_argv(req, prompt_file=prompt_file)
    assert "--prompt-json" not in argv
    idx = argv.index("--prompt-file")
    assert argv[idx + 1] == str(prompt_file)
    loaded = json.loads(prompt_file.read_text())
    assert loaded[0]["text"] == "look"
    assert loaded[1]["mimeType"] == "image/jpeg"


def test_run_image_argv_under_arg_limit_and_prompt_file_valid(tmp_path: Path):
    img = tmp_path / "page.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * 8192)
    fixture_stdout = (FIXTURES / "grok-result.json").read_text()
    captured: dict = {}

    def runner(argv, **kwargs):
        captured["argv"] = argv
        pf_idx = argv.index("--prompt-file")
        prompt_path = Path(argv[pf_idx + 1])
        assert prompt_path.is_file()
        blocks = json.loads(prompt_path.read_text())
        assert isinstance(blocks, list)
        assert blocks[0]["type"] == "text"
        assert any(b.get("mimeType") == "image/png" for b in blocks)

        class R:
            returncode = 0
            stdout = fixture_stdout
            stderr = ""

        return R()

    prov = GrokCliProvider(
        models=[Model("m", "M")],
        runner=runner,
        which=lambda name: "/usr/bin/grok",
    )
    prov.run(
        ProviderRequest(
            prompt="describe pages",
            model_id="grok-4.7",
            image_paths=[img],
            cwd=tmp_path,
        )
    )
    argv = captured["argv"]
    assert "--prompt-json" not in argv
    assert max(len(str(a)) for a in argv) < 100_000


def test_run_parses_fixture(tmp_path: Path):
    fixture_stdout = (FIXTURES / "grok-result.json").read_text()
    captured = {}

    def runner(argv, **kwargs):
        captured["argv"] = argv

        class R:
            returncode = 0
            stdout = fixture_stdout
            stderr = ""

        return R()

    prov = GrokCliProvider(models=[Model("m", "M")], runner=runner, which=lambda name: "/usr/bin/grok")
    res = prov.run(ProviderRequest(prompt="go", model_id="grok-4.7", cwd=tmp_path))
    assert res.markdown == "arbor-ok"
    assert captured["argv"][1] == "--prompt-file"


def test_run_raises_on_error_json(tmp_path: Path):
    prov = GrokCliProvider(models=[Model("m", "M")], which=lambda name: "/usr/bin/grok", runner=lambda *a, **k: type(
        "R", (), {"returncode": 1, "stdout": '{"type":"error","message":"bad"}', "stderr": ""}
    )())
    with pytest.raises(ProviderError, match="bad"):
        prov.run(ProviderRequest(prompt="p", model_id="grok-4.7", cwd=tmp_path))


def test_run_nonzero_without_json_error_uses_stderr(tmp_path: Path):
    stderr = "error: unexpected argument '--nope'"

    def runner(*a, **k):
        return type("R", (), {"returncode": 1, "stdout": "", "stderr": stderr})()

    prov = GrokCliProvider(models=[Model("m", "M")], runner=runner, which=lambda name: "/usr/bin/grok")
    with pytest.raises(ProviderError, match="unexpected argument") as exc:
        prov.run(ProviderRequest(prompt="p", model_id="grok-4.7", cwd=tmp_path))
    assert "grok failed (1)" in str(exc.value)


def test_auth_success():
    prov = GrokCliProvider(
        models=[Model("m", "M")],
        which=lambda name: "/usr/bin/grok",
        runner=lambda *a, **k: type(
            "R", (), {"returncode": 0, "stdout": "You are logged in with grok.com.", "stderr": ""}
        )(),
    )
    assert prov.is_available() is True


def test_auth_not_logged_in():
    prov = GrokCliProvider(
        models=[Model("m", "M")],
        which=lambda name: "/usr/bin/grok",
        runner=lambda *a, **k: type(
            "R", (), {"returncode": 0, "stdout": "please log in", "stderr": ""}
        )(),
    )
    assert prov.is_available() is False


def test_auth_timeout():
    import subprocess

    def runner(*a, **k):
        raise subprocess.TimeoutExpired(cmd="grok", timeout=10)

    prov = GrokCliProvider(
        models=[Model("m", "M")],
        which=lambda name: "/usr/bin/grok",
        runner=runner,
    )
    assert prov.is_available() is False


def test_run_raises_when_cli_missing(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("arbor_worker.auth.Path.home", lambda: tmp_path)

    def runner(*args, **kwargs):
        raise AssertionError("runner must not be called")

    prov = GrokCliProvider(
        models=[Model("m", "M")],
        runner=runner,
        which=lambda name: None,
    )
    with pytest.raises(ProviderError, match="Grok CLI not found on PATH"):
        prov.run(ProviderRequest(prompt="p", model_id="grok-4.7", cwd=tmp_path))

import subprocess
from pathlib import Path

from arbor_worker.auth import check_codex_auth, resolve_cli_command, resolve_codex_command


class FakeCompleted:
    def __init__(self, returncode, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_resolve_prefers_which_on_path():
    assert resolve_codex_command(which=lambda name: "/usr/bin/codex") == "/usr/bin/codex"


def test_resolve_falls_back_to_executable_home_local_bin(tmp_path: Path):
    exe = tmp_path / ".local" / "bin" / "codex"
    exe.parent.mkdir(parents=True)
    exe.write_text("#!/bin/sh\n")
    exe.chmod(0o755)
    assert resolve_codex_command(which=lambda name: None, home=tmp_path) == str(exe)


def test_resolve_missing_both_returns_none(tmp_path: Path):
    assert resolve_codex_command(which=lambda name: None, home=tmp_path, extra_dirs=[]) is None


def test_missing_binary(tmp_path: Path):
    res = check_codex_auth(
        runner=lambda *a, **k: FakeCompleted(0),
        which=lambda name: None,
        home=tmp_path,
        extra_dirs=[],
    )
    assert res.ok is False
    assert "not found" in res.reason.lower()


def test_authenticated():
    res = check_codex_auth(
        runner=lambda *a, **k: FakeCompleted(0, stdout="Logged in"),
        which=lambda name: "/usr/bin/codex",
    )
    assert res.ok is True


def test_not_authenticated():
    res = check_codex_auth(
        runner=lambda *a, **k: FakeCompleted(1, stdout="Not logged in"),
        which=lambda name: "/usr/bin/codex",
    )
    assert res.ok is False
    assert "not logged in" in res.reason.lower()


def test_home_fallback_when_which_misses(tmp_path: Path):
    exe = tmp_path / ".local" / "bin" / "codex"
    exe.parent.mkdir(parents=True)
    exe.write_text("#!/bin/sh\n")
    exe.chmod(0o755)
    captured = {}

    def runner(argv, **kwargs):
        captured["argv"] = argv
        return FakeCompleted(0, stdout="Logged in")

    res = check_codex_auth(runner=runner, which=lambda name: None, home=tmp_path)
    assert res.ok is True
    assert captured["argv"][0] == str(exe)


def test_login_status_uses_resolved_path():
    captured = {}

    def runner(argv, **kwargs):
        captured["argv"] = argv
        return FakeCompleted(0)

    res = check_codex_auth(runner=runner, which=lambda name: "/opt/codex")
    assert res.ok is True
    assert captured["argv"][:3] == ["/opt/codex", "login", "status"]


def test_extra_bin_dirs_includes_common_home_install_paths(tmp_path: Path):
    from arbor_worker.auth import extra_bin_dirs

    paths = extra_bin_dirs(tmp_path)
    assert tmp_path / ".claude" / "local" in paths
    assert tmp_path / ".cargo" / "bin" in paths
    assert len(paths) == len(set(paths))


def test_resolve_claude_local_bin(tmp_path: Path):
    claude_dir = tmp_path / ".claude" / "local"
    claude_dir.mkdir(parents=True)
    exe = claude_dir / "claude"
    exe.write_text("#!/bin/sh\n")
    exe.chmod(0o755)
    assert resolve_cli_command("claude", which=lambda name: None, home=tmp_path) == str(exe)


def test_resolve_grok_home_bin(tmp_path: Path):
    grok_bin = tmp_path / ".grok" / "bin"
    grok_bin.mkdir(parents=True)
    exe = grok_bin / "grok"
    exe.write_text("#!/bin/sh\n")
    exe.chmod(0o755)
    assert resolve_cli_command("grok", which=lambda name: None, home=tmp_path) == str(exe)


def test_resolve_falls_back_to_extra_bin_dir(tmp_path: Path):
    brew = tmp_path / "opt" / "homebrew" / "bin"
    brew.mkdir(parents=True)
    exe = brew / "codex"
    exe.write_text("#!/bin/sh\n")
    exe.chmod(0o755)
    assert resolve_codex_command(
        which=lambda name: None,
        home=tmp_path,
        extra_dirs=[brew],
    ) == str(exe)


def test_gui_path_prepends_extra_dirs_to_finder_path(tmp_path: Path):
    from arbor_worker.auth import gui_path

    brew = tmp_path / "opt" / "homebrew" / "bin"
    local = tmp_path / ".local" / "bin"
    brew.mkdir(parents=True)
    local.mkdir(parents=True)
    path = gui_path(
        home=tmp_path,
        current="/usr/bin:/bin",
        extra_dirs=[brew, local],
    )
    parts = path.split(":")
    assert str(brew) in parts
    assert str(local) in parts
    assert parts.index(str(brew)) < parts.index("/usr/bin")
    assert parts.index(str(local)) < parts.index("/usr/bin")


def test_login_status_passes_gui_path_to_runner(tmp_path: Path):
    brew = tmp_path / "opt" / "homebrew" / "bin"
    brew.mkdir(parents=True)
    exe = brew / "codex"
    exe.write_text("#!/bin/sh\n")
    exe.chmod(0o755)
    captured = {}

    def runner(argv, **kwargs):
        captured["argv"] = argv
        captured["env"] = kwargs.get("env")
        return FakeCompleted(0, stdout="Logged in")

    res = check_codex_auth(
        runner=runner,
        which=lambda name: None,
        home=tmp_path,
        extra_dirs=[brew],
    )
    assert res.ok is True
    assert captured["argv"][0] == str(exe)
    assert str(brew) in captured["env"]["PATH"].split(":")


def test_runner_oserror_is_not_authenticated():
    def runner(argv, **kwargs):
        raise FileNotFoundError("codex")

    res = check_codex_auth(runner=runner, which=lambda name: "/usr/bin/codex")
    assert res.ok is False
    assert "codex" in res.reason.lower()

    captured = {}

    def runner(argv, **kwargs):
        captured["timeout"] = kwargs.get("timeout")
        raise subprocess.TimeoutExpired(cmd=argv, timeout=kwargs.get("timeout") or 10)

    res = check_codex_auth(runner=runner, which=lambda name: "/usr/bin/codex")
    assert captured["timeout"] == 10
    assert res.ok is False
    assert "timeout" in res.reason.lower()

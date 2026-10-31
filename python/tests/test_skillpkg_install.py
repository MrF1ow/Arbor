from __future__ import annotations

import json
import os
import shlex
import subprocess
from pathlib import Path

import pytest

from arbor_worker.skillpkg import (
    SkillPackageError,
    install_skill,
    skills_root,
    uninstall_skill,
)


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=True,
    )


def _write_manifest(root: Path, skill_id: str = "demo-skill", entry: str = "demo_skill:run") -> None:
    root.mkdir(parents=True, exist_ok=True)
    manifest = {
        "id": skill_id,
        "version": "1.0.0",
        "kind": "skill",
        "entry": entry,
        "inputs": [],
        "outputs": [],
        "permissions": [],
    }
    (root / "arbor-skill.json").write_text(json.dumps(manifest), encoding="utf-8")


def _bare_repo_with_package(
    tmp_path: Path,
    *,
    rel_package: str | None = None,
    skill_id: str = "demo-skill",
    entry: str = "demo_skill:run",
    marker: Path | None = None,
) -> tuple[Path, str]:
    repo = tmp_path / "source"
    repo.mkdir()
    package_dir = repo / rel_package if rel_package else repo
    marker_line = ""
    if marker is not None:
        marker_line = (
            f"__import__('pathlib').Path({marker.as_posix()!r}).write_text('ran', encoding='utf-8')\n"
        )
    module_body = (
        f"{marker_line}"
        "def run():\n"
        "    return None\n"
    )
    setup_body = (
        f"{marker_line}"
        "from setuptools import setup\n"
        "setup(name='evil')\n"
    )
    _write_manifest(package_dir, skill_id=skill_id, entry=entry)
    (package_dir / "demo_skill.py").write_text(module_body, encoding="utf-8")
    (package_dir / "setup.py").write_text(setup_body, encoding="utf-8")

    _git(repo, "init")
    _git(repo, "config", "user.email", "test@test")
    _git(repo, "config", "user.name", "Test")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "pkg")
    sha = _git(repo, "rev-parse", "HEAD").stdout.strip()

    bare = tmp_path / "bare.git"
    subprocess.run(
        ["git", "clone", "--bare", str(repo), str(bare)],
        check=True,
        capture_output=True,
        text=True,
    )
    return bare, sha


def test_install_from_bare_path(tmp_path: Path) -> None:
    marker = tmp_path / "import_marker"
    bare, sha = _bare_repo_with_package(tmp_path, marker=marker)
    data_home = tmp_path / "data"

    installed = install_skill(str(bare), sha, data_home=data_home)

    dest = data_home / "arbor" / "skills" / "demo-skill" / sha
    assert installed.path == dest
    assert (dest / "arbor-skill.json").is_file()
    meta = json.loads((dest / "arbor-install.json").read_text(encoding="utf-8"))
    assert meta["commit"] == sha
    assert not (dest / ".git").exists()
    assert not marker.exists()


def test_install_via_file_url(tmp_path: Path) -> None:
    bare, sha = _bare_repo_with_package(tmp_path)
    data_home = tmp_path / "data2"
    url = bare.as_uri()

    installed = install_skill(url, sha, data_home=data_home)
    assert installed.path == data_home / "arbor" / "skills" / "demo-skill" / sha


@pytest.mark.parametrize("bad_commit", ["main", "HEAD", "abc1234"])
def test_invalid_commit_refuses_before_install(tmp_path: Path, bad_commit: str) -> None:
    bare, _sha = _bare_repo_with_package(tmp_path)
    data_home = tmp_path / "data"
    with pytest.raises(SkillPackageError):
        install_skill(str(bare), bad_commit, data_home=data_home)
    assert not skills_root(data_home).exists()


def test_missing_commit_object_refuses(tmp_path: Path) -> None:
    bare, _sha = _bare_repo_with_package(tmp_path)
    data_home = tmp_path / "data"
    missing = "0" * 40
    with pytest.raises(SkillPackageError):
        install_skill(str(bare), missing, data_home=data_home)
    assert not (skills_root(data_home) / "demo-skill").exists()


def test_subdir_install(tmp_path: Path) -> None:
    bare, sha = _bare_repo_with_package(tmp_path, rel_package="packages/demo")
    data_home = tmp_path / "data"

    installed = install_skill(
        str(bare),
        sha,
        subdir="packages/demo",
        data_home=data_home,
    )
    assert (installed.path / "arbor-skill.json").is_file()
    assert (installed.path / "demo_skill.py").is_file()


def test_subdir_traversal_refused(tmp_path: Path) -> None:
    bare, sha = _bare_repo_with_package(tmp_path)
    data_home = tmp_path / "data"
    with pytest.raises(SkillPackageError):
        install_skill(str(bare), sha, subdir="../outside", data_home=data_home)
    assert not skills_root(data_home).exists()


def test_absolute_symlink_escape_refused(tmp_path: Path) -> None:
    work = tmp_path / "work"
    work.mkdir()
    _write_manifest(work)
    (work / "demo_skill.py").write_text("def run():\n    pass\n", encoding="utf-8")
    subdir = work / "subdir"
    subdir.mkdir()
    outside = tmp_path / "secret.txt"
    outside.write_text("secret", encoding="utf-8")
    abs_escape = Path(f"{subdir.resolve()}/../../secret.txt")
    os.symlink(abs_escape, work / "leak")

    repo = tmp_path / "source2"
    repo.mkdir()
    subprocess.run(["git", "init"], cwd=repo, check=True, capture_output=True)
    _git(repo, "config", "user.email", "test@test")
    _git(repo, "config", "user.name", "Test")
    subprocess.run(["cp", "-a", f"{work}/.", str(repo)], check=True)
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "leak")
    sha = _git(repo, "rev-parse", "HEAD").stdout.strip()
    bare = tmp_path / "bare2.git"
    subprocess.run(
        ["git", "clone", "--bare", str(repo), str(bare)],
        check=True,
        capture_output=True,
        text=True,
    )
    data_home = tmp_path / "data"
    with pytest.raises(SkillPackageError):
        install_skill(str(bare), sha, data_home=data_home)
    assert not (skills_root(data_home) / "demo-skill").exists()


def test_reinstall_same_pin_succeeds(tmp_path: Path) -> None:
    bare, sha = _bare_repo_with_package(tmp_path)
    data_home = tmp_path / "data"

    first = install_skill(str(bare), sha, data_home=data_home)
    second = install_skill(str(bare), sha, data_home=data_home)

    dest = data_home / "arbor" / "skills" / "demo-skill" / sha
    assert first.path == dest
    assert second.path == dest
    assert (dest / "arbor-skill.json").is_file()
    assert not (dest / "arbor-skill.json").is_symlink()


def test_install_git_calls_disable_hooks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    bare, sha = _bare_repo_with_package(tmp_path)
    calls: list[list[str]] = []
    real_run = subprocess.run

    def spy(argv, *args, **kwargs):
        if isinstance(argv, list) and argv and argv[0] == "git":
            calls.append(list(argv))
        return real_run(argv, *args, **kwargs)

    monkeypatch.setattr("arbor_worker.skillpkg.install.subprocess.run", spy)
    install_skill(str(bare), sha, data_home=tmp_path / "data")

    assert calls
    for argv in calls:
        assert argv[:3] == ["git", "-c", "core.hooksPath=/dev/null"]


def test_install_ignores_template_post_checkout_hook(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bare, sha = _bare_repo_with_package(tmp_path)
    template = tmp_path / "template" / "hooks"
    template.mkdir(parents=True)
    marker = tmp_path / "hook-marker"
    hook = template / "post-checkout"
    hook.write_text(
        "#!/bin/sh\n" + f"echo ran > {shlex.quote(str(marker))}\n",
        encoding="utf-8",
    )
    hook.chmod(0o755)
    monkeypatch.setenv("GIT_TEMPLATE_DIR", str(template.parent))

    control = tmp_path / "control"
    subprocess.run(
        ["git", "clone", "--no-checkout", "--", str(bare), str(control)],
        check=True,
        capture_output=True,
        text=True,
    )
    subprocess.run(
        ["git", "-C", str(control), "checkout", "--detach", sha],
        check=True,
        capture_output=True,
        text=True,
    )
    assert marker.is_file()
    marker.unlink()

    installed = install_skill(str(bare), sha, data_home=tmp_path / "data")

    assert installed.path.is_dir()
    assert not marker.exists()


def test_symlinked_arbor_dir_refused(tmp_path: Path) -> None:
    bare, sha = _bare_repo_with_package(tmp_path)
    data_home = tmp_path / "data"
    data_home.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    os.symlink(outside, data_home / "arbor")

    with pytest.raises(SkillPackageError, match="^invalid skills root$"):
        install_skill(str(bare), sha, data_home=data_home)

    assert not (outside / "skills").exists()
    assert list(outside.iterdir()) == []


def test_real_arbor_dir_still_installs(tmp_path: Path) -> None:
    bare, sha = _bare_repo_with_package(tmp_path)
    data_home = tmp_path / "data"
    arbor = data_home / "arbor"
    arbor.mkdir(parents=True)

    installed = install_skill(str(bare), sha, data_home=data_home)

    assert not arbor.is_symlink()
    assert installed.path == arbor / "skills" / "demo-skill" / sha
    assert installed.path.is_dir()


def test_arbor_dir_symlinked_during_mkdir_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bare, sha = _bare_repo_with_package(tmp_path)
    data_home = tmp_path / "data"
    data_home.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    arbor = data_home / "arbor"
    real_mkdir = Path.mkdir

    def racing_mkdir(self: Path, *args, **kwargs) -> None:
        if self == arbor:
            os.symlink(outside, arbor)
        real_mkdir(self, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", racing_mkdir)
    with pytest.raises(SkillPackageError, match="^invalid skills root$"):
        install_skill(str(bare), sha, data_home=data_home)
    assert list(outside.iterdir()) == []


@pytest.mark.parametrize("linked", ["arbor", "skills"])
def test_uninstall_through_symlinked_root_refused(tmp_path: Path, linked: str) -> None:
    bare, sha = _bare_repo_with_package(tmp_path)
    real_home = tmp_path / "real"
    install_skill(str(bare), sha, data_home=real_home)
    data_home = tmp_path / "data"
    if linked == "arbor":
        data_home.mkdir()
        os.symlink(real_home / "arbor", data_home / "arbor")
    else:
        (data_home / "arbor").mkdir(parents=True)
        os.symlink(real_home / "arbor" / "skills", data_home / "arbor" / "skills")

    with pytest.raises(SkillPackageError, match="^invalid skills root$"):
        uninstall_skill("demo-skill", data_home=data_home)
    assert (skills_root(real_home) / "demo-skill" / sha).is_dir()


def test_uninstall_without_skills_root_says_not_installed(tmp_path: Path) -> None:
    with pytest.raises(SkillPackageError, match="^skill not installed: demo-skill$"):
        uninstall_skill("demo-skill", data_home=tmp_path / "data")


def test_symlinked_skill_id_dir_refused(tmp_path: Path) -> None:
    bare, sha = _bare_repo_with_package(tmp_path)
    data_home = tmp_path / "data"
    outside = tmp_path / "outside"
    outside.mkdir()
    skills = skills_root(data_home)
    skills.mkdir(parents=True)
    os.symlink(outside, skills / "demo-skill")

    with pytest.raises(SkillPackageError):
        install_skill(str(bare), sha, data_home=data_home)

    assert not list(outside.iterdir())


def test_uninstall_removes_id_directory(tmp_path: Path) -> None:
    bare, sha = _bare_repo_with_package(tmp_path)
    data_home = tmp_path / "data"
    install_skill(str(bare), sha, data_home=data_home)
    id_root = skills_root(data_home) / "demo-skill"
    assert id_root.is_dir()

    removed = uninstall_skill("demo-skill", data_home=data_home)
    assert removed == id_root
    assert not id_root.exists()

    with pytest.raises(SkillPackageError):
        uninstall_skill("demo-skill", data_home=data_home)


def test_uninstall_invalid_id_does_not_touch_data_home(tmp_path: Path) -> None:
    data_home = tmp_path / "data"
    data_home.mkdir()
    sentinel = data_home / "keep.txt"
    sentinel.write_text("ok", encoding="utf-8")
    with pytest.raises(SkillPackageError):
        uninstall_skill("../x", data_home=data_home)
    assert sentinel.read_text(encoding="utf-8") == "ok"


def test_cli_install_and_uninstall(tmp_path: Path) -> None:
    bare, sha = _bare_repo_with_package(tmp_path)
    data_home = tmp_path / "data"

    install_proc = subprocess.run(
        [
            "uv",
            "run",
            "arbor-worker",
            "skill-install",
            "--git",
            str(bare),
            "--commit",
            sha,
            "--data-home",
            str(data_home),
        ],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        check=False,
    )
    assert install_proc.returncode == 0, install_proc.stderr
    payload = json.loads(install_proc.stdout.strip())
    assert payload["id"] == "demo-skill"
    assert payload["commit"] == sha
    assert payload["version"] == "1.0.0"

    uninstall_proc = subprocess.run(
        [
            "uv",
            "run",
            "arbor-worker",
            "skill-uninstall",
            "--id",
            "demo-skill",
            "--data-home",
            str(data_home),
        ],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        check=False,
    )
    assert uninstall_proc.returncode == 0, uninstall_proc.stderr
    assert json.loads(uninstall_proc.stdout.strip()) == {
        "id": "demo-skill",
        "removed": True,
    }

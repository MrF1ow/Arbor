from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from arbor_worker.skillpkg import (
    SkillPackageError,
    SkillPermissionError,
    install_skill,
    run_installed_skill,
)


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=True,
    )


def _bare_repo(
    tmp_path: Path,
    *,
    skill_id: str = "demo-skill",
    permissions: list[str] | None = None,
    module_body: str,
    marker: Path | None = None,
    setup_marker: Path | None = None,
) -> tuple[Path, str]:
    repo = tmp_path / "source"
    repo.mkdir()
    perms = permissions if permissions is not None else []
    manifest = {
        "id": skill_id,
        "version": "1.0.0",
        "kind": "skill",
        "entry": "demo_skill:run",
        "inputs": [],
        "outputs": [],
        "permissions": perms,
    }
    (repo / "arbor-skill.json").write_text(json.dumps(manifest), encoding="utf-8")

    marker_line = ""
    if marker is not None:
        marker_line = (
            f"__import__('pathlib').Path({marker.as_posix()!r}).write_text('ran', encoding='utf-8')\n"
        )
    setup_marker_line = ""
    if setup_marker is not None:
        setup_marker_line = (
            f"__import__('pathlib').Path({setup_marker.as_posix()!r}).write_text('ran', encoding='utf-8')\n"
        )
    (repo / "demo_skill.py").write_text(f"{marker_line}{module_body}", encoding="utf-8")
    (repo / "setup.py").write_text(
        f"{setup_marker_line}from setuptools import setup\nsetup(name='evil')\n",
        encoding="utf-8",
    )

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


def _knowledge_layout(tmp_path: Path, *, course: str = "Biology") -> tuple[Path, Path]:
    knowledge = tmp_path / "knowledge"
    course_dir = knowledge / course
    study = course_dir / "study"
    study.mkdir(parents=True)
    deck = {
        "schema_version": 1,
        "course": course,
        "cards": [{"id": "c1", "front": "Mitochondria", "back": "Powerhouse", "source": {}}],
    }
    (study / "flashcards.json").write_text(json.dumps(deck), encoding="utf-8")
    export_dir = tmp_path / "export"
    export_dir.mkdir()
    return knowledge, export_dir


def _install(bare: Path, sha: str, data_home: Path) -> None:
    install_skill(str(bare), sha, data_home=data_home)


def _run(
    sha: str,
    *,
    data_home: Path,
    knowledge: Path,
    export_dir: Path,
    grants: list[str],
    confirmed: bool,
    skill_id: str = "demo-skill",
    course: str = "Biology",
) -> None:
    run_installed_skill(
        skill_id,
        sha,
        knowledge_root=knowledge,
        course=course,
        export_dir=export_dir,
        grants=grants,
        confirmed=confirmed,
        data_home=data_home,
    )


_EXPORT_SKILL = """
def run(ctx):
    import json
    raw = ctx.read_course_file("study/flashcards.json")
    deck = json.loads(raw)
    front = deck["cards"][0]["front"]
    ctx.write_export("deck.tsv", front.encode("utf-8"))
"""


def test_not_confirmed_skips_import(tmp_path: Path) -> None:
    marker = tmp_path / "import_marker"
    bare, sha = _bare_repo(tmp_path, module_body="def run(ctx):\n    pass\n", marker=marker)
    data_home = tmp_path / "data"
    knowledge, export_dir = _knowledge_layout(tmp_path)
    _install(bare, sha, data_home)

    with pytest.raises(SkillPermissionError):
        _run(
            sha,
            data_home=data_home,
            knowledge=knowledge,
            export_dir=export_dir,
            grants=[],
            confirmed=False,
        )
    assert not marker.exists()


@pytest.mark.parametrize(
    "grants",
    [
        [],
        ["read_course"],
        ["read_course", "write_export_dir", "network"],
    ],
)
def test_grant_mismatch_skips_import(tmp_path: Path, grants: list[str]) -> None:
    marker = tmp_path / "import_marker"
    bare, sha = _bare_repo(
        tmp_path,
        permissions=["read_course", "write_export_dir"],
        module_body=_EXPORT_SKILL,
        marker=marker,
    )
    data_home = tmp_path / "data"
    knowledge, export_dir = _knowledge_layout(tmp_path)
    _install(bare, sha, data_home)

    with pytest.raises(SkillPermissionError):
        _run(
            sha,
            data_home=data_home,
            knowledge=knowledge,
            export_dir=export_dir,
            grants=grants,
            confirmed=True,
        )
    assert not marker.exists()


def test_confirmed_run_reads_and_exports(tmp_path: Path) -> None:
    bare, sha = _bare_repo(
        tmp_path,
        permissions=["read_course", "write_export_dir"],
        module_body=_EXPORT_SKILL,
    )
    data_home = tmp_path / "data"
    knowledge, export_dir = _knowledge_layout(tmp_path)
    _install(bare, sha, data_home)

    _run(
        sha,
        data_home=data_home,
        knowledge=knowledge,
        export_dir=export_dir,
        grants=["read_course", "write_export_dir"],
        confirmed=True,
    )

    out_file = export_dir / "deck.tsv"
    assert out_file.read_text(encoding="utf-8") == "Mitochondria"
    assert not (tmp_path / "deck.tsv").exists()


_TRAVERSAL_SKILL = """
def run(ctx):
    ctx.write_export("../outside.txt", b"escaped")
"""


def test_write_export_rejects_parent_relative(tmp_path: Path) -> None:
    bare, sha = _bare_repo(
        tmp_path,
        permissions=["write_export_dir"],
        module_body=_TRAVERSAL_SKILL,
    )
    data_home = tmp_path / "data"
    knowledge, export_dir = _knowledge_layout(tmp_path)
    sibling = tmp_path / "outside.txt"
    sibling.write_text("keep", encoding="utf-8")
    _install(bare, sha, data_home)

    with pytest.raises(SkillPackageError):
        _run(
            sha,
            data_home=data_home,
            knowledge=knowledge,
            export_dir=export_dir,
            grants=["write_export_dir"],
            confirmed=True,
        )
    assert sibling.read_text(encoding="utf-8") == "keep"


_ABSOLUTE_SKILL = """
def run(ctx):
    ctx.write_export({path!r}, b"escaped")
"""


def test_write_export_rejects_absolute(tmp_path: Path) -> None:
    absolute_target = tmp_path / "absolute-target"
    bare, sha = _bare_repo(
        tmp_path,
        permissions=["write_export_dir"],
        module_body=_ABSOLUTE_SKILL.format(path=str(absolute_target)),
    )
    data_home = tmp_path / "data"
    knowledge, export_dir = _knowledge_layout(tmp_path)
    _install(bare, sha, data_home)

    with pytest.raises(SkillPackageError):
        _run(
            sha,
            data_home=data_home,
            knowledge=knowledge,
            export_dir=export_dir,
            grants=["write_export_dir"],
            confirmed=True,
        )
    assert not absolute_target.exists()


def test_write_export_refuses_symlink(tmp_path: Path) -> None:
    outside = tmp_path / "outside-secret.txt"
    outside.write_bytes(b"secret")
    skill = """
def run(ctx):
    ctx.write_export("link-out", b"new")
"""
    bare, sha = _bare_repo(
        tmp_path,
        permissions=["write_export_dir"],
        module_body=skill,
    )
    data_home = tmp_path / "data"
    knowledge, export_dir = _knowledge_layout(tmp_path)
    os.symlink(outside, export_dir / "link-out")
    _install(bare, sha, data_home)

    with pytest.raises(SkillPackageError):
        _run(
            sha,
            data_home=data_home,
            knowledge=knowledge,
            export_dir=export_dir,
            grants=["write_export_dir"],
            confirmed=True,
        )
    assert outside.read_bytes() == b"secret"


_READ_WITHOUT_GRANT = """
def run(ctx):
    ctx.read_course_file("study/flashcards.json")
"""


def test_read_course_file_without_permission(tmp_path: Path) -> None:
    bare, sha = _bare_repo(
        tmp_path,
        permissions=["write_export_dir"],
        module_body=_READ_WITHOUT_GRANT,
    )
    data_home = tmp_path / "data"
    knowledge, export_dir = _knowledge_layout(tmp_path)
    _install(bare, sha, data_home)

    with pytest.raises(SkillPackageError, match="read_course permission required"):
        _run(
            sha,
            data_home=data_home,
            knowledge=knowledge,
            export_dir=export_dir,
            grants=["write_export_dir"],
            confirmed=True,
        )


_ENV_SKILL = """
def run(ctx):
    import os
    payload = {
        "openai": os.environ.get("ARBOR_OPENAI_API_KEY"),
        "sentinel": os.environ.get("SECRET_SENTINEL"),
        "home": os.environ.get("HOME"),
    }
    import json
    ctx.write_export("env.json", json.dumps(payload).encode("utf-8"))
"""


def test_child_env_strips_secrets_without_provider(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARBOR_OPENAI_API_KEY", "sk-test-arbor-not-a-real-key")
    monkeypatch.setenv("SECRET_SENTINEL", "nope")
    real_home = str(Path.home())

    bare, sha = _bare_repo(
        tmp_path,
        permissions=["write_export_dir"],
        module_body=_ENV_SKILL,
    )
    data_home = tmp_path / "data"
    knowledge, export_dir = _knowledge_layout(tmp_path)
    _install(bare, sha, data_home)

    _run(
        sha,
        data_home=data_home,
        knowledge=knowledge,
        export_dir=export_dir,
        grants=["write_export_dir"],
        confirmed=True,
    )

    payload = json.loads((export_dir / "env.json").read_text(encoding="utf-8"))
    assert payload["openai"] is None
    assert payload["sentinel"] is None
    assert payload["home"] != real_home


def test_provider_grant_passes_arbor_openai_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARBOR_OPENAI_API_KEY", "sk-test-arbor-not-a-real-key")
    monkeypatch.setenv("SECRET_SENTINEL", "nope")

    bare, sha = _bare_repo(
        tmp_path,
        permissions=["write_export_dir", "provider"],
        module_body=_ENV_SKILL,
    )
    data_home = tmp_path / "data"
    knowledge, export_dir = _knowledge_layout(tmp_path)
    _install(bare, sha, data_home)

    _run(
        sha,
        data_home=data_home,
        knowledge=knowledge,
        export_dir=export_dir,
        grants=["write_export_dir", "provider"],
        confirmed=True,
    )

    payload = json.loads((export_dir / "env.json").read_text(encoding="utf-8"))
    assert payload["openai"] == "sk-test-arbor-not-a-real-key"
    assert payload["sentinel"] is None


def test_setup_py_not_executed(tmp_path: Path) -> None:
    setup_marker = tmp_path / "setup_marker"
    bare, sha = _bare_repo(
        tmp_path,
        permissions=["write_export_dir"],
        module_body="def run(ctx):\n    ctx.write_export('ok.txt', b'1')\n",
        setup_marker=setup_marker,
    )
    data_home = tmp_path / "data"
    knowledge, export_dir = _knowledge_layout(tmp_path)
    _install(bare, sha, data_home)

    _run(
        sha,
        data_home=data_home,
        knowledge=knowledge,
        export_dir=export_dir,
        grants=["write_export_dir"],
        confirmed=True,
    )
    assert not setup_marker.exists()
    assert (export_dir / "ok.txt").read_bytes() == b"1"


def test_cli_skill_run(tmp_path: Path) -> None:
    bare, sha = _bare_repo(
        tmp_path,
        permissions=["write_export_dir"],
        module_body="def run(ctx):\n    ctx.write_export('cli.txt', b'ok')\n",
    )
    data_home = tmp_path / "data"
    knowledge, export_dir = _knowledge_layout(tmp_path)
    _install(bare, sha, data_home)

    proc = subprocess.run(
        [
            "uv",
            "run",
            "arbor-worker",
            "skill-run",
            "--id",
            "demo-skill",
            "--commit",
            sha,
            "--root",
            str(knowledge),
            "--course",
            "Biology",
            "--export-dir",
            str(export_dir),
            "--data-home",
            str(data_home),
            "--confirmed",
            "--grant",
            "write_export_dir",
        ],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout.strip()) == {
        "id": "demo-skill",
        "commit": sha,
        "ok": True,
    }
    assert (export_dir / "cli.txt").read_bytes() == b"ok"

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from arbor_worker.skillpkg import SkillPackageError, install_skill
from arbor_worker.skillpkg.index import (
    fetch_index,
    find_default_index,
    load_index_file,
    parse_index,
)


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=True,
    )


def _valid_package_entry(
    *,
    pkg_id: str = "anki-export",
    git: str = "file:///tmp/repo.git",
    commit: str = "0" * 40,
    subdir: str | None = "marketplace/packages/anki-export",
) -> dict:
    entry: dict = {
        "id": pkg_id,
        "kind": "skill",
        "name": "Anki export",
        "description": "Export the course deck to a TSV file.",
        "git": git,
        "commit": commit,
        "permissions": ["read_course", "write_export_dir"],
    }
    if subdir is not None:
        entry["subdir"] = subdir
    return entry


def _valid_index(**overrides) -> dict:
    data = {"packages": [_valid_package_entry()]}
    data.update(overrides)
    return data


def test_valid_index_parses() -> None:
    index = parse_index(_valid_index())
    assert len(index.packages) == 1
    assert index.packages[0].id == "anki-export"


def test_unknown_key_rejected() -> None:
    data = _valid_index()
    data["extra"] = True
    with pytest.raises(SkillPackageError):
        parse_index(data)


def test_unknown_permission_rejected() -> None:
    data = _valid_index()
    data["packages"][0]["permissions"] = ["read_course", "not_real"]
    with pytest.raises(SkillPackageError):
        parse_index(data)


def test_duplicate_id_rejected() -> None:
    data = _valid_index(
        packages=[
            _valid_package_entry(pkg_id="dup"),
            _valid_package_entry(pkg_id="dup", git="file:///other"),
        ]
    )
    with pytest.raises(SkillPackageError):
        parse_index(data)


def test_branch_name_in_commit_rejected() -> None:
    data = _valid_index()
    data["packages"][0]["commit"] = "main"
    with pytest.raises(SkillPackageError):
        parse_index(data)


def test_load_index_file_rejects_symlink(tmp_path: Path) -> None:
    real = tmp_path / "index.json"
    real.write_text(json.dumps(_valid_index()), encoding="utf-8")
    link = tmp_path / "linked.json"
    os.symlink(real, link)
    with pytest.raises(SkillPackageError, match="symlink"):
        load_index_file(link)


def test_fetch_index_local_file(tmp_path: Path) -> None:
    path = tmp_path / "index.json"
    path.write_text(json.dumps(_valid_index()), encoding="utf-8")
    index = fetch_index(str(path))
    assert index.packages[0].name == "Anki export"


def test_fetch_index_directory_with_marketplace_index(tmp_path: Path) -> None:
    root = tmp_path / "catalog"
    index_path = root / "marketplace" / "index.json"
    index_path.parent.mkdir(parents=True)
    index_path.write_text(json.dumps(_valid_index()), encoding="utf-8")
    index = fetch_index(str(root))
    assert index.packages[0].id == "anki-export"


def test_find_default_index_walks_parents(tmp_path: Path) -> None:
    root = tmp_path / "tree"
    index_path = root / "marketplace" / "index.json"
    index_path.parent.mkdir(parents=True)
    index_path.write_text("{}", encoding="utf-8")
    start = root / "python" / "src"
    start.mkdir(parents=True)
    found = find_default_index(start)
    assert found == index_path


def test_find_default_index_absent_returns_none(tmp_path: Path) -> None:
    start = tmp_path / "nowhere" / "deep"
    start.mkdir(parents=True)
    assert find_default_index(start) is None


def test_fetch_index_bare_repo_installs_package(tmp_path: Path) -> None:
    marker = tmp_path / "import_marker"
    repo = tmp_path / "index-repo"
    repo.mkdir()
    package_rel = "marketplace/packages/demo-skill"
    package_dir = repo / package_rel
    package_dir.mkdir(parents=True)
    manifest = {
        "id": "demo-skill",
        "version": "1.0.0",
        "kind": "skill",
        "entry": "demo_skill:run",
        "inputs": [],
        "outputs": [],
        "permissions": [],
    }
    (package_dir / "arbor-skill.json").write_text(json.dumps(manifest), encoding="utf-8")
    marker_line = (
        f"__import__('pathlib').Path({marker.as_posix()!r}).write_text('ran', encoding='utf-8')\n"
    )
    (package_dir / "demo_skill.py").write_text(
        f"{marker_line}def run():\n    return None\n",
        encoding="utf-8",
    )

    _git(repo, "init")
    _git(repo, "config", "user.email", "test@test")
    _git(repo, "config", "user.name", "Test")
    _git(repo, "checkout", "-b", "market")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "package")
    pkg_sha = _git(repo, "rev-parse", "HEAD").stdout.strip()

    bare = tmp_path / "bare.git"
    git_field = f"file://{bare.resolve()}"

    index_doc = {
        "packages": [
            {
                "id": "demo-skill",
                "kind": "skill",
                "name": "Demo",
                "description": "Demo skill from index.",
                "git": git_field,
                "commit": pkg_sha,
                "subdir": package_rel,
                "permissions": [],
            }
        ]
    }
    (repo / "marketplace" / "index.json").write_text(
        json.dumps(index_doc),
        encoding="utf-8",
    )
    _git(repo, "add", "marketplace/index.json")
    _git(repo, "commit", "-m", "add index")
    subprocess.run(
        ["git", "clone", "--bare", str(repo), str(bare)],
        check=True,
        capture_output=True,
        text=True,
    )

    index = fetch_index(str(bare), ref="market")
    assert len(index.packages) == 1
    entry = index.packages[0]
    assert entry.commit == pkg_sha
    assert entry.subdir == package_rel

    data_home = tmp_path / "data"
    installed = install_skill(
        entry.git,
        entry.commit,
        subdir=entry.subdir,
        data_home=data_home,
    )
    assert installed.id == "demo-skill"
    assert not marker.exists()


def _commit_index_repo(tmp_path: Path) -> tuple[Path, str]:
    repo = tmp_path / "index-repo"
    repo.mkdir()
    index_path = repo / "marketplace" / "index.json"
    index_path.parent.mkdir(parents=True)
    index_path.write_text(json.dumps(_valid_index()), encoding="utf-8")
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "user.email", "test@test")
    _git(repo, "config", "user.name", "Test")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "index")
    sha = _git(repo, "rev-parse", "HEAD").stdout.strip()
    _git(repo, "branch", "release/5.0")
    _git(repo, "tag", "v1.2")
    return repo, sha


@pytest.mark.parametrize("bad_ref", ["-x", "--upload-pack=evil", "a..b", "main.lock", "foo/"])
def test_fetch_index_rejects_invalid_ref_without_git(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, bad_ref: str
) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    calls: list[object] = []

    def spy(argv, *args, **kwargs):
        calls.append(argv)
        raise AssertionError(f"git should not run for {bad_ref!r}: {argv}")

    monkeypatch.setattr("arbor_worker.skillpkg.index.subprocess.run", spy)
    with pytest.raises(SkillPackageError, match="^invalid index ref$"):
        fetch_index(str(repo), ref=bad_ref)
    assert calls == []


@pytest.mark.parametrize("ref_kind", ["main", "v1.2", "release/5.0", "HEAD", "sha"])
def test_fetch_index_accepts_index_ref(tmp_path: Path, ref_kind: str) -> None:
    repo, sha = _commit_index_repo(tmp_path)
    ref = sha if ref_kind == "sha" else ref_kind
    index = fetch_index(str(repo), ref=ref)
    assert index.packages[0].id == "anki-export"


def test_cli_skill_index(tmp_path: Path) -> None:
    path = tmp_path / "index.json"
    path.write_text(json.dumps(_valid_index()), encoding="utf-8")
    proc = subprocess.run(
        [
            "uv",
            "run",
            "arbor-worker",
            "skill-index",
            "--source",
            str(path),
        ],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout.strip())
    assert payload["packages"][0]["id"] == "anki-export"

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from arbor_worker import cli
from arbor_worker.gitstate import effective_git_email
from arbor_worker.library import (
    LIBRARY_REL,
    LibraryError,
    VIEWER_WRITE_DENIED,
    create_shared_library,
    current_role,
    join_library,
    load_library,
    migrate_library_file,
    set_library_members,
    set_library_provider,
)
from arbor_worker.sync import migrate_derived_files, set_remote, sync_pull_strategy


def _run_git(root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
        check=check,
    )


def _isolated_git_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    xdg = tmp_path / "xdg"
    xdg.mkdir()
    global_cfg = tmp_path / "global.gitconfig"
    global_cfg.write_text("")
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(xdg))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(global_cfg))
    for key in (
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
    ):
        monkeypatch.delenv(key, raising=False)


def _init_work_repo(tmp_path: Path, email: str | None = None) -> Path:
    root = tmp_path / "work"
    root.mkdir()
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    if email is not None:
        _run_git(root, "config", "user.email", email)
        _run_git(root, "config", "user.name", "Test")
    (root / "README.md").write_text("init\n")
    _run_git(root, "add", "README.md")
    if email is not None:
        _run_git(root, "commit", "-m", "init")
    else:
        subprocess.run(
            [
                "git",
                "-C",
                str(root),
                "-c",
                "user.name=Arbor",
                "-c",
                "user.email=arbor@localhost",
                "commit",
                "-m",
                "init",
            ],
            check=True,
        )
    return root


def _bare_with_library(tmp_path: Path, lib_name: str = "SharedLib") -> Path:
    bare = tmp_path / "lib.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    seed = tmp_path / "seed"
    subprocess.run(["git", "clone", "-q", str(bare), str(seed)], check=True)
    _run_git(seed, "config", "user.email", "owner@test.local")
    _run_git(seed, "config", "user.name", "Owner")
    lib_dir = seed / ".arbor"
    lib_dir.mkdir()
    doc = {
        "name": lib_name,
        "members": ["owner@test.local"],
        "created_by": "owner@test.local",
    }
    (lib_dir / "library.json").write_text(json.dumps(doc, indent=2) + "\n")
    _run_git(seed, "add", ".arbor/library.json")
    _run_git(seed, "commit", "-m", "library")
    _run_git(seed, "push", "-u", "origin", "HEAD")
    return bare


def test_effective_git_email_isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    root = tmp_path / "bare-email"
    root.mkdir()
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    assert effective_git_email(root) == "arbor@localhost"
    _run_git(root, "config", "user.email", "ada@example.com")
    assert effective_git_email(root) == "ada@example.com"


def test_create_without_remote_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    root = _init_work_repo(tmp_path, email="ada@example.com")
    with pytest.raises(LibraryError, match="Arbor remote"):
        create_shared_library(root)
    assert not (root / LIBRARY_REL).exists()


def test_create_with_remote_writes_and_commits(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = _init_work_repo(tmp_path, email="ada@example.com")
    set_remote(root, str(bare))
    doc = create_shared_library(root, name="Botany")
    assert doc == {
        "name": "Botany",
        "created_by": "ada@example.com",
        "members": [{"email": "ada@example.com", "role": "owner"}],
    }
    assert load_library(root) == doc
    tracked = _run_git(root, "ls-files").stdout
    assert ".arbor/library.json" in tracked
    ignore = subprocess.run(
        ["git", "-C", str(root), "check-ignore", ".arbor/library.json"],
        capture_output=True,
        text=True,
    )
    assert ignore.returncode != 0
    sync_json = json.loads((root / ".arbor/sync.json").read_text())
    assert sync_json.get("shared") is True


def test_create_does_not_commit_hand_staged(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = _init_work_repo(tmp_path, email="ada@example.com")
    set_remote(root, str(bare))
    (root / "unrelated.txt").write_text("x\n")
    _run_git(root, "add", "unrelated.txt")
    create_shared_library(root)
    show = _run_git(root, "show", "--name-only", "--pretty=format:").stdout
    assert "library.json" in show
    assert "unrelated.txt" not in show
    status = _run_git(root, "status", "--porcelain").stdout
    assert status.startswith("A  unrelated.txt")


def test_create_fallback_email_commits(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = _init_work_repo(tmp_path, email=None)
    set_remote(root, str(bare))
    doc = create_shared_library(root)
    assert doc["created_by"] == "arbor@localhost"
    assert doc["members"] == [{"email": "arbor@localhost", "role": "owner"}]
    assert _run_git(root, "rev-parse", "HEAD").returncode == 0


def test_create_again_no_extra_commit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = _init_work_repo(tmp_path, email="ada@example.com")
    set_remote(root, str(bare))
    first = create_shared_library(root, name="Botany")
    count = _run_git(root, "rev-list", "--count", "HEAD").stdout.strip()
    second = create_shared_library(root, name="Ignored")
    assert second == first
    assert _run_git(root, "rev-list", "--count", "HEAD").stdout.strip() == count


def test_library_json_not_ignored_after_migrate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = _init_work_repo(tmp_path, email="ada@example.com")
    set_remote(root, str(bare))
    create_shared_library(root)
    migrate_derived_files(root)
    ignore = subprocess.run(
        ["git", "-C", str(root), "check-ignore", ".arbor/library.json"],
        capture_output=True,
        text=True,
    )
    assert ignore.returncode != 0


def test_sync_pull_strategy_library_json(tmp_path: Path):
    root = tmp_path / "root"
    root.mkdir()
    lib = root / ".arbor"
    lib.mkdir()
    doc = {
        "name": "Lib",
        "members": ["a@test.local"],
        "created_by": "a@test.local",
    }
    (lib / "library.json").write_text(json.dumps(doc, indent=2) + "\n")
    assert sync_pull_strategy(root) == "merge"
    plain = tmp_path / "plain"
    plain.mkdir()
    assert sync_pull_strategy(plain) == "rebase"


def test_join_into_missing_dest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = _bare_with_library(tmp_path, "Botany")
    dest = tmp_path / "joined"
    result = join_library(str(bare), dest)
    assert result["kind"] == "shared"
    assert result["name"] == "Botany"
    assert (dest / LIBRARY_REL).is_file()
    remotes = _run_git(dest, "remote").stdout.splitlines()
    assert "arbor" in remotes


def test_join_nonempty_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = _bare_with_library(tmp_path)
    dest = tmp_path / "occupied"
    dest.mkdir()
    (dest / "existing.txt").write_text("stay\n")
    with pytest.raises(LibraryError, match="not empty"):
        join_library(str(bare), dest)
    assert not (dest / ".git").exists()
    assert (dest / "existing.txt").read_text() == "stay\n"


def test_join_missing_library_json_cleanup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = tmp_path / "plain.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    seed = tmp_path / "seed"
    subprocess.run(["git", "clone", "-q", str(bare), str(seed)], check=True)
    _run_git(seed, "config", "user.email", "a@test.local")
    _run_git(seed, "config", "user.name", "A")
    (seed / "note.md").write_text("x\n")
    _run_git(seed, "add", "note.md")
    _run_git(seed, "commit", "-m", "init")
    _run_git(seed, "push", "-u", "origin", "HEAD")
    dest = tmp_path / "fail-join"
    with pytest.raises(LibraryError, match="library.json"):
        join_library(str(bare), dest)
    assert not dest.exists()


def test_join_refuses_embedded_password(tmp_path: Path):
    dest = tmp_path / "never"
    with pytest.raises(LibraryError, match="embedded password"):
        join_library("https://user:secret@example.com/lib.git", dest)
    assert not dest.exists()


def test_cli_library_create_join(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = _bare_with_library(tmp_path, "CLI Lib")
    root = _init_work_repo(tmp_path, email="cli@test.local")
    set_remote(root, str(bare))
    code = cli.main(["library-create", "--root", str(root), "--name", "CLI Lib"])
    assert code == 0
    out = capsys.readouterr().out
    assert json.loads(out)["name"] == "CLI Lib"
    dest = tmp_path / "cli-dest"
    code = cli.main(["library-join", "--url", str(bare), "--dest", str(dest)])
    assert code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["kind"] == "shared"
    assert payload["members"] == [
        {"email": "owner@test.local", "role": "owner"},
    ]


def _write_string_member_library(
    root: Path,
    *,
    name: str = "Lib",
    created_by: str = "owner@test.local",
    members: list[str],
) -> None:
    lib = root / ".arbor"
    lib.mkdir(parents=True, exist_ok=True)
    doc = {"name": name, "created_by": created_by, "members": members}
    (lib / "library.json").write_text(json.dumps(doc, indent=2) + "\n")


def _init_library_repo(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    email: str,
    *,
    string_members: list[str] | None = None,
) -> Path:
    _isolated_git_env(monkeypatch, tmp_path)
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = _init_work_repo(tmp_path, email=email)
    set_remote(root, str(bare))
    if string_members is not None:
        _write_string_member_library(root, members=string_members, created_by=email)
        _run_git(root, "add", ".arbor/library.json")
        _run_git(root, "commit", "-m", "library")
    else:
        create_shared_library(root)
    return root


def test_load_library_normalizes_string_members_without_rewrite(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    root = _init_library_repo(
        tmp_path,
        monkeypatch,
        "owner@test.local",
        string_members=["owner@test.local", "editor@test.local"],
    )
    path = root / LIBRARY_REL
    before = path.read_bytes()
    doc = load_library(root)
    assert doc["members"] == [
        {"email": "owner@test.local", "role": "owner"},
        {"email": "editor@test.local", "role": "editor"},
    ]
    assert path.read_bytes() == before


def test_string_members_prepend_created_by_owner(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = _init_library_repo(
        tmp_path,
        monkeypatch,
        "owner@test.local",
        string_members=["editor@test.local"],
    )
    doc = load_library(root)
    assert doc["members"][0] == {"email": "owner@test.local", "role": "owner"}
    assert doc["members"][1] == {"email": "editor@test.local", "role": "editor"}


def test_migrate_library_file_rewrites_once(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = _init_library_repo(
        tmp_path,
        monkeypatch,
        "owner@test.local",
        string_members=["owner@test.local", "bea@example.com"],
    )
    path = root / LIBRARY_REL
    assert '"role"' not in path.read_text()
    doc = migrate_library_file(root)
    assert doc["members"][1]["role"] == "editor"
    text = path.read_text()
    assert '"role"' in text
    assert path.read_text().startswith('{\n  "name"')
    bytes_after = path.read_bytes()
    migrate_library_file(root)
    assert path.read_bytes() == bytes_after


def test_current_role_cases(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    root = tmp_path / "roles"
    root.mkdir()
    lib = root / ".arbor"
    lib.mkdir()
    doc = {
        "name": "R",
        "created_by": "Owner@Test.Local",
        "members": [
            {"email": "Owner@Test.Local", "role": "owner"},
            {"email": "editor@test.local", "role": "editor"},
            {"email": "viewer@test.local", "role": "viewer"},
        ],
    }
    (lib / "library.json").write_text(json.dumps(doc, indent=2) + "\n")
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    _run_git(root, "config", "user.email", "owner@test.local")
    assert current_role(root) == "owner"
    _run_git(root, "config", "user.email", "editor@test.local")
    assert current_role(root) == "editor"
    _run_git(root, "config", "user.email", "viewer@test.local")
    assert current_role(root) == "viewer"
    _run_git(root, "config", "user.email", "stranger@test.local")
    assert current_role(root) == "viewer"
    plain = tmp_path / "plain"
    plain.mkdir()
    assert current_role(plain) is None
    _run_git(root, "config", "--unset", "user.email")
    assert current_role(root) == "viewer"
    fallback_doc = {
        "name": "R",
        "created_by": "editor@test.local",
        "members": [
            {"email": "arbor@localhost", "role": "owner"},
            {"email": "editor@test.local", "role": "editor"},
        ],
    }
    (lib / "library.json").write_text(json.dumps(fallback_doc, indent=2) + "\n")
    monkeypatch.delenv("GIT_AUTHOR_EMAIL", raising=False)
    monkeypatch.delenv("GIT_COMMITTER_EMAIL", raising=False)
    assert current_role(root) == "owner"


def test_set_members_and_provider_skip_commit_when_unchanged(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    root = _init_library_repo(tmp_path, monkeypatch, "owner@test.local")
    members = [
        {"email": "owner@test.local", "role": "owner"},
        {"email": "editor@test.local", "role": "editor"},
    ]
    set_library_members(root, members)
    count_after_members = _run_git(root, "rev-list", "--count", "HEAD").stdout.strip()
    set_library_members(root, members)
    assert _run_git(root, "rev-list", "--count", "HEAD").stdout.strip() == count_after_members
    provider = {"id": "grok", "model": "grok-4.7"}
    doc = set_library_provider(root, provider)
    assert doc["provider"] == provider
    count_after_provider = _run_git(root, "rev-list", "--count", "HEAD").stdout.strip()
    doc_again = set_library_provider(root, provider)
    assert doc_again["provider"] == provider
    assert _run_git(root, "rev-list", "--count", "HEAD").stdout.strip() == count_after_provider


def test_owner_set_members_commits_only_library_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    root = _init_library_repo(
        tmp_path,
        monkeypatch,
        "owner@test.local",
        string_members=["owner@test.local", "editor@test.local"],
    )
    migrate_library_file(root)
    _run_git(root, "add", ".arbor/library.json")
    _run_git(root, "commit", "-m", "migrate")
    (root / "unrelated.txt").write_text("x\n")
    _run_git(root, "add", "unrelated.txt")
    count_before = _run_git(root, "rev-list", "--count", "HEAD").stdout.strip()
    new_members = [
        {"email": "owner@test.local", "role": "owner"},
        {"email": "editor@test.local", "role": "viewer"},
    ]
    set_library_members(root, new_members)
    count_after = _run_git(root, "rev-list", "--count", "HEAD").stdout.strip()
    assert int(count_after) == int(count_before) + 1
    show = _run_git(root, "show", "--name-only", "--pretty=format:").stdout
    assert "library.json" in show
    assert "unrelated.txt" not in show
    status = _run_git(root, "status", "--porcelain").stdout
    assert status.startswith("A  unrelated.txt")
    assert load_library(root)["members"][1]["role"] == "viewer"


def test_editor_cannot_set_members(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = _init_library_repo(
        tmp_path,
        monkeypatch,
        "owner@test.local",
        string_members=["owner@test.local", "editor@test.local"],
    )
    migrate_library_file(root)
    _run_git(root, "add", ".arbor/library.json")
    _run_git(root, "commit", "-m", "migrate")
    _run_git(root, "config", "user.email", "editor@test.local")
    before = (root / LIBRARY_REL).read_bytes()
    count = _run_git(root, "rev-list", "--count", "HEAD").stdout.strip()
    with pytest.raises(LibraryError, match="Only an owner"):
        set_library_members(
            root,
            [
                {"email": "owner@test.local", "role": "viewer"},
                {"email": "editor@test.local", "role": "owner"},
            ],
        )
    assert (root / LIBRARY_REL).read_bytes() == before
    assert _run_git(root, "rev-list", "--count", "HEAD").stdout.strip() == count


def test_viewer_cannot_set_members_or_provider(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = _init_library_repo(tmp_path, monkeypatch, "owner@test.local")
    set_library_members(
        root,
        [
            {"email": "owner@test.local", "role": "owner"},
            {"email": "viewer@test.local", "role": "viewer"},
        ],
    )
    _run_git(root, "config", "user.email", "viewer@test.local")
    before = (root / LIBRARY_REL).read_bytes()
    count = _run_git(root, "rev-list", "--count", "HEAD").stdout.strip()
    with pytest.raises(LibraryError, match="Only an owner"):
        set_library_members(
            root,
            [
                {"email": "owner@test.local", "role": "owner"},
                {"email": "viewer@test.local", "role": "editor"},
            ],
        )
    with pytest.raises(LibraryError, match="viewer"):
        set_library_provider(root, {"id": "grok", "model": "grok-4.7"})
    assert (root / LIBRARY_REL).read_bytes() == before
    assert _run_git(root, "rev-list", "--count", "HEAD").stdout.strip() == count


def test_editor_can_set_and_clear_provider(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = _init_library_repo(tmp_path, monkeypatch, "editor@test.local")
    set_library_members(
        root,
        [
            {"email": "owner@test.local", "role": "owner"},
            {"email": "editor@test.local", "role": "editor"},
        ],
    )
    _run_git(root, "config", "user.email", "editor@test.local")
    doc = set_library_provider(root, {"id": "grok", "model": "grok-4.7"})
    assert doc["provider"] == {"id": "grok", "model": "grok-4.7"}
    cleared = set_library_provider(root, None)
    assert "provider" not in cleared
    assert "provider" not in (root / LIBRARY_REL).read_text()


@pytest.mark.parametrize(
    "mutator",
    [
        lambda d: {**d, "api_key": "x"},
        lambda d: {**d, "api-key": "x"},
        lambda d: {**d, "API_KEY": "x"},
        lambda d: {**d, "token": "x"},
        lambda d: {**d, "secret": "x"},
        lambda d: {**d, "password": "x"},
        lambda d: {**d, "credentials": "x"},
        lambda d: {**d, "authorization": "x"},
        lambda d: {**d, "access_key": "x"},
        lambda d: {**d, "private_key": "x"},
        lambda d: {**d, "key": "x"},
        lambda d: {
            **d,
            "provider": {"id": "grok", "model": "m", "api_key": "nope"},
        },
        lambda d: {
            **d,
            "members": [{"email": "a@t.local", "role": "owner", "secret": "nope"}],
        },
    ],
)
def test_rejects_credential_like_keys(tmp_path: Path, mutator):
    base = {
        "name": "L",
        "created_by": "a@test.local",
        "members": [{"email": "a@test.local", "role": "owner"}],
    }
    root = tmp_path / "cred"
    root.mkdir()
    lib = root / ".arbor"
    lib.mkdir()
    (lib / "library.json").write_text(json.dumps(mutator(base), indent=2) + "\n")
    with pytest.raises(LibraryError, match="must not contain credentials"):
        load_library(root)


@pytest.mark.parametrize(
    "provider",
    [
        {"id": "grok", "model": "grok-4.7", "extra": "x"},
        {"id": "", "model": "m"},
        {"id": "grok", "model": ""},
        {"id": "Grok", "model": "m"},
    ],
)
def test_invalid_provider_shape(tmp_path: Path, provider: dict):
    root = tmp_path / "prov"
    root.mkdir()
    lib = root / ".arbor"
    lib.mkdir()
    doc = {
        "name": "L",
        "created_by": "a@test.local",
        "members": [{"email": "a@test.local", "role": "owner"}],
        "provider": provider,
    }
    (lib / "library.json").write_text(json.dumps(doc, indent=2) + "\n")
    with pytest.raises(LibraryError, match="Invalid library.json"):
        load_library(root)


def test_cli_library_show_members_provider_migrate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
):
    root = _init_library_repo(
        tmp_path,
        monkeypatch,
        "owner@test.local",
        string_members=["owner@test.local", "editor@test.local"],
    )
    code = cli.main(["library-show", "--root", str(root)])
    assert code == 0
    show = json.loads(capsys.readouterr().out)
    assert show["present"] is True
    assert show["role"] == "owner"
    assert show["members"][1]["role"] == "editor"

    members_json = json.dumps(
        [
            {"email": "owner@test.local", "role": "owner"},
            {"email": "editor@test.local", "role": "editor"},
            {"email": "viewer@test.local", "role": "viewer"},
        ]
    )
    code = cli.main(["library-members", "--root", str(root), "--members", members_json])
    assert code == 0
    assert len(json.loads(capsys.readouterr().out)["members"]) == 3

    code = cli.main(
        [
            "library-provider",
            "--root",
            str(root),
            "--id",
            "grok",
            "--model",
            "grok-4.7",
        ]
    )
    assert code == 0
    assert json.loads(capsys.readouterr().out)["provider"]["model"] == "grok-4.7"

    mig_root = tmp_path / "m2"
    mig_root.mkdir()
    root2 = _init_library_repo(
        mig_root,
        monkeypatch,
        "owner@test.local",
        string_members=["owner@test.local"],
    )
    code = cli.main(["library-migrate", "--root", str(root2)])
    assert code == 0
    migrated = json.loads(capsys.readouterr().out)
    assert migrated["members"][0]["role"] == "owner"
    assert '"role"' in (root2 / LIBRARY_REL).read_text()

from __future__ import annotations

import io
import json
import subprocess
from pathlib import Path

import pytest

from arbor_worker import cli
from arbor_worker.embed import embed_root, search_chunks
from arbor_worker.embedder.hashed import HashedNgramEmbedder
from arbor_worker.indexer import open_db
from arbor_worker import sync as sync_mod
from arbor_worker.sync import (
    GitSyncError,
    SyncConflictError,
    continue_sync,
    migrate_derived_files,
    redact_git_text,
    remote_note,
    remote_url,
    resolve_conflict,
    set_remote,
    set_shared,
    sync_remote_name,
    sync_root,
)


def _run_git(root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
        check=check,
    )


def _init_clone(bare: Path, dest: Path) -> None:
    subprocess.run(["git", "clone", "-q", str(bare), str(dest)], check=True)
    _run_git(dest, "config", "user.email", "sync@test.local")
    _run_git(dest, "config", "user.name", "Sync Test")
    set_remote(dest, str(bare))


def _bare_and_clones(tmp_path: Path) -> tuple[Path, Path, Path]:
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    a = tmp_path / "a"
    b = tmp_path / "b"
    subprocess.run(["git", "clone", "-q", str(bare), str(a)], check=True)
    _run_git(a, "config", "user.email", "a@test.local")
    _run_git(a, "config", "user.name", "A")
    _run_git(a, "commit", "--allow-empty", "-m", "init")
    _run_git(a, "push", "-u", "origin", "HEAD")
    branch = _run_git(a, "symbolic-ref", "--short", "HEAD").stdout.strip()
    _run_git(a, "branch", "-M", branch)
    set_remote(a, str(bare))
    _init_clone(bare, b)
    return bare, a, b


def _commit_all(root: Path, message: str) -> None:
    _run_git(root, "add", "-A")
    _run_git(root, "commit", "-m", message)


def _git_push_targets(args: list[str]) -> list[str]:
    if not args or args[0] != "push":
        return []
    remotes: list[str] = []
    for arg in args[1:]:
        if arg in ("-u", "--set-upstream", "HEAD"):
            continue
        if arg.startswith("-"):
            continue
        remotes.append(arg)
        break
    return remotes


def test_clean_push(tmp_path: Path):
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = tmp_path / "solo"
    subprocess.run(["git", "clone", "-q", str(bare), str(root)], check=True)
    _run_git(root, "config", "user.email", "solo@test.local")
    _run_git(root, "config", "user.name", "Solo")
    set_remote(root, str(bare))
    (root / "note.md").write_text("# Hello\n")
    _commit_all(root, "add note")
    report = sync_root(root)
    assert report.ok and report.action == "pushed"
    log = _run_git(bare, "log", "--oneline").stdout
    assert "add note" in log


def test_fast_forward_pull_reindexes(tmp_path: Path):
    bare, a, b = _bare_and_clones(tmp_path)
    unique = "QuuxFastForwardWord"
    digest = a / "Biology" / "digests" / "leaf.md"
    digest.parent.mkdir(parents=True)
    digest.write_text(f"# Leaf\n\n{unique}\n")
    _commit_all(a, "digest on A")
    sync_root(a)
    report = sync_root(b)
    assert report.ok and report.action == "integrated"
    assert (b / "Biology" / "digests" / "leaf.md").read_text().count(unique) == 1
    conn = open_db(b)
    row = conn.execute(
        "SELECT title FROM search_index WHERE search_index MATCH ?",
        (unique.lower(),),
    ).fetchone()
    conn.close()
    assert row is not None


def test_diverged_rebase_keeps_both_files(tmp_path: Path):
    bare, a, b = _bare_and_clones(tmp_path)
    (a / "only-a.md").write_text("a\n")
    _commit_all(a, "a file")
    sync_root(a)
    (b / "only-b.md").write_text("b\n")
    _commit_all(b, "b file")
    report = sync_root(b)
    assert report.ok and report.action == "integrated"
    assert (b / "only-a.md").is_file()
    assert (b / "only-b.md").is_file()
    merges = _run_git(b, "log", "--merges", "--oneline").stdout.strip()
    assert merges == ""
    sync_root(b)
    subject = _run_git(bare, "log", "-1", "--pretty=%s").stdout.strip()
    assert subject == "b file"


def test_text_conflict_resolve_mine_then_continue(tmp_path: Path):
    bare, a, b = _bare_and_clones(tmp_path)
    path = Path("Biology/digests/leaf.md")
    for root in (a, b):
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_text("line one\n")
        _commit_all(root, "leaf")
        migrate_derived_files(root)
    sync_root(a)
    (a / path).write_text("from A\n")
    _commit_all(a, "A edit")
    sync_root(a)
    (b / path).write_text("from B\n")
    _commit_all(b, "B edit")
    pre_b = _run_git(b, "rev-parse", "HEAD").stdout.strip()
    report = sync_root(b)
    assert not report.ok and report.action == "conflict"
    assert path.as_posix() in (report.files or [])
    assert _run_git(b, "rev-parse", "HEAD").stdout.strip() == pre_b
    assert not (b / ".git" / "rebase-merge").exists()
    assert not (b / ".git" / "MERGE_HEAD").exists()
    assert "<<<<<<" not in (b / path).read_text()
    resolve_conflict(b, path.as_posix(), "mine")
    cont = continue_sync(b)
    assert cont.ok
    sync_root(a)
    assert (a / path).read_text() == "from B\n"


def test_text_conflict_theirs_produces_a_text(tmp_path: Path):
    bare, a, b = _bare_and_clones(tmp_path)
    path = Path("Biology/digests/leaf.md")
    for root in (a, b):
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_text("shared\n")
        _commit_all(root, "leaf")
    sync_root(a)
    (a / path).write_text("from A\n")
    _commit_all(a, "A edit")
    sync_root(a)
    (b / path).write_text("from B\n")
    _commit_all(b, "B edit")
    sync_root(b)
    resolve_conflict(b, path.as_posix(), "theirs")
    continue_sync(b)
    assert (b / path).read_text() == "from A\n"


def test_binary_conflict_not_resolvable(tmp_path: Path):
    bare, a, b = _bare_and_clones(tmp_path)
    path = Path("Biology/figure.png")
    for root in (a, b):
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_bytes(b"\x00png-a")
        _commit_all(root, "fig")
        migrate_derived_files(root)
    sync_root(a)
    (a / path).write_bytes(b"\x00png-A2")
    _commit_all(a, "A fig")
    sync_root(a)
    (b / path).write_bytes(b"\x00png-B2")
    _commit_all(b, "B fig")
    pre_b = _run_git(b, "rev-parse", "HEAD").stdout.strip()
    report = sync_root(b)
    assert path.as_posix() in (report.files or [])
    with pytest.raises(SyncConflictError, match="binary"):
        resolve_conflict(b, path.as_posix(), "mine")
    with pytest.raises(SyncConflictError, match="binary"):
        continue_sync(b)
    assert _run_git(b, "rev-parse", "HEAD").stdout.strip() == pre_b
    assert not (b / ".git" / "rebase-merge").exists()


def test_migrate_derived_files_untracks_and_commits(tmp_path: Path):
    root = tmp_path / "repo"
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    _run_git(root, "config", "user.email", "m@test.local")
    _run_git(root, "config", "user.name", "M")
    paths = [
        Path("_arbor_cache/x"),
        Path(".arbor/arbor.db"),
        Path(".arbor/vectors.sqlite"),
        Path(".arbor/chat/Biology.jsonl"),
    ]
    for rel in paths:
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"data")
        _run_git(root, "add", str(rel))
    _run_git(root, "commit", "-m", "track derived")
    migrate_derived_files(root)
    for rel in paths:
        assert (root / rel).is_file()
    tracked = _run_git(root, "ls-files").stdout.splitlines()
    for rel in paths:
        assert rel.as_posix() not in tracked
    gi = (root / ".gitignore").read_text()
    for entry in (
        "_arbor_cache/",
        ".arbor/progress/",
        ".arbor/*.db",
        ".arbor/chat/",
        ".arbor/sync-conflict.json",
    ):
        assert entry in gi
    subject = _run_git(root, "log", "-1", "--pretty=%s").stdout.strip()
    assert subject == "chore: ignore derived Arbor files"


def test_rebuild_embeddings_after_upstream_digest_change(tmp_path: Path):
    bare, a, b = _bare_and_clones(tmp_path)
    path = Path("Biology/digests/leaf.md")
    new_term = "EmbeddingRebuildTerm88"
    (b / path).parent.mkdir(parents=True)
    (b / path).write_text(f"# T\n\n{new_term}\n")
    _commit_all(b, "digest")
    sync_root(b)
    sync_root(a)
    embed_root(b, HashedNgramEmbedder())
    updated = f"{new_term} updated on A"
    (a / path).write_text(f"# T\n\n{updated}\n")
    _commit_all(a, "change digest")
    sync_root(a)
    report = sync_root(b)
    assert report.ok and report.action == "integrated"
    hits = search_chunks(b, updated, limit=5, embedder=HashedNgramEmbedder())
    assert hits
    assert any(updated in str(h.get("snippet", "")) for h in hits)


def test_set_remote_rejects_embedded_password(tmp_path: Path):
    root = tmp_path / "r"
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    with pytest.raises(GitSyncError, match="embedded password"):
        set_remote(root, "https://user:s3cret@example.com/know.git")
    cfg = (root / ".git" / "config").read_text()
    assert "s3cret" not in cfg


def test_redact_git_text():
    raw = "fatal: Authentication failed for 'https://user:s3cret@example.com/know.git/'"
    out = redact_git_text(raw)
    assert "s3cret" not in out
    assert "fatal: Authentication failed" in out
    assert "https://user:***@example.com/know.git/" in out


def test_shared_root_merge(tmp_path: Path):
    bare, a, b = _bare_and_clones(tmp_path)
    set_shared(b, True)
    _commit_all(b, "track shared")
    (a / "a-only.md").write_text("a\n")
    _commit_all(a, "a")
    sync_root(a)
    (b / "b-only.md").write_text("b\n")
    _commit_all(b, "b")
    report = sync_root(b)
    assert report.ok
    merges = _run_git(b, "log", "--merges", "--oneline").stdout.strip()
    assert merges != ""


def test_sync_after_commit_append_card(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = tmp_path / "know"
    subprocess.run(["git", "clone", "-q", str(bare), str(root)], check=True)
    _run_git(root, "config", "user.email", "k@test.local")
    _run_git(root, "config", "user.name", "K")
    _run_git(root, "commit", "--allow-empty", "-m", "init")
    _run_git(root, "push", "-u", "origin", "HEAD")
    set_remote(root, str(bare))
    course = root / "Biology"
    (course / "digests").mkdir(parents=True)
    (course / "digests" / "a.md").write_text("# A\n")
    _commit_all(root, "course")
    sync_root(root)
    settings = root / ".arbor" / "settings.json"
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(json.dumps({"sync_after_commit": True}) + "\n")
    argv = [
        "append-card",
        "--root",
        str(root),
        "--course",
        "Biology",
        "--front",
        "Q?",
        "--back",
        "A",
        "--digest",
        "digests/a.md",
    ]
    err = io.StringIO()
    import contextlib
    import sys

    with contextlib.redirect_stderr(err):
        code = cli.main(argv)
    assert code == 0
    log = _run_git(bare, "log", "--oneline").stdout
    assert "study: Biology flashcard" in log

    settings.write_text(json.dumps({"sync_after_commit": False}) + "\n")
    argv2 = [
        "append-card",
        "--root",
        str(root),
        "--course",
        "Biology",
        "--front",
        "Q2?",
        "--back",
        "A2",
        "--digest",
        "digests/a.md",
    ]
    before = _run_git(bare, "rev-parse", "HEAD").stdout.strip()
    with contextlib.redirect_stderr(io.StringIO()):
        cli.main(argv2)
    after = _run_git(bare, "rev-parse", "HEAD").stdout.strip()
    assert before == after


def test_rebase_failure_keeps_original_error_when_abort_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    bare, a, b = _bare_and_clones(tmp_path)
    original_git = sync_mod._git
    real_abort = sync_mod._abort_any_in_progress
    original_message = "ORIGINAL_REBASE_FAILURE_XYZZY"
    abort_calls = {"n": 0}

    def fake_git(root: Path, args, *, runner=subprocess.run, identity=False, check=False):
        if (
            len(args) == 2
            and args[0] == "rebase"
            and args[1].split("/", 1)[0] in ("arbor", "origin")
        ):
            rebase_dir = root / ".git" / "rebase-merge"
            rebase_dir.mkdir(parents=True, exist_ok=True)
            return subprocess.CompletedProcess(
                args,
                1,
                stdout="",
                stderr=original_message,
            )
        return original_git(root, args, runner=runner, identity=identity, check=check)

    def flaky_abort(root: Path, runner=subprocess.run) -> None:
        abort_calls["n"] += 1
        if abort_calls["n"] == 1:
            raise GitSyncError("abort runner failed")
        for name in ("rebase-merge", "rebase-apply"):
            stale = root / ".git" / name
            if stale.is_dir():
                import shutil

                shutil.rmtree(stale)
        real_abort(root, runner)

    (a / "only-a.md").write_text("a\n")
    _commit_all(a, "a only")
    sync_root(a)
    (b / "only-b.md").write_text("b\n")
    _commit_all(b, "b only")

    monkeypatch.setattr(sync_mod, "_git", fake_git)
    monkeypatch.setattr(sync_mod, "_abort_any_in_progress", flaky_abort)

    with pytest.raises(GitSyncError, match=original_message):
        sync_root(b)

    assert abort_calls["n"] >= 1
    assert not (b / ".git" / "rebase-merge").exists()
    assert not (b / ".git" / "rebase-apply").exists()


def test_same_url_origin_is_the_sync_remote(tmp_path: Path, monkeypatch):
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = tmp_path / "solo"
    subprocess.run(["git", "clone", "-q", str(bare), str(root)], check=True)
    _run_git(root, "config", "user.email", "solo@test.local")
    _run_git(root, "config", "user.name", "Solo")
    set_remote(root, str(bare))

    assert sync_remote_name(root) == "origin"
    assert remote_note(root) is None

    invocations: list[list[str]] = []
    real_git = sync_mod._git

    def spy_git(root_path, args, **kwargs):
        invocations.append(list(args))
        return real_git(root_path, args, **kwargs)

    monkeypatch.setattr(sync_mod, "_git", spy_git)

    (root / "note.md").write_text("# Hello\n")
    _commit_all(root, "add note")
    report = sync_root(root)
    assert report.ok and report.action == "pushed"

    assert any(a[:2] == ["fetch", "origin"] for a in invocations)
    assert any("origin" in _git_push_targets(a) for a in invocations)
    assert not any(a[:2] == ["fetch", "arbor"] for a in invocations)
    assert not any("arbor" in _git_push_targets(a) for a in invocations)
    log = _run_git(bare, "log", "--oneline").stdout
    assert "add note" in log


def test_different_origin_url_syncs_arbor_and_notes(tmp_path: Path, monkeypatch):
    bare_a = tmp_path / "remote-a.git"
    bare_b = tmp_path / "remote-b.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare_a)], check=True)
    subprocess.run(["git", "init", "--bare", "-q", str(bare_b)], check=True)
    root = tmp_path / "solo"
    subprocess.run(["git", "clone", "-q", str(bare_a), str(root)], check=True)
    _run_git(root, "config", "user.email", "solo@test.local")
    _run_git(root, "config", "user.name", "Solo")
    set_remote(root, str(bare_b))

    assert sync_remote_name(root) == "arbor"
    note = remote_note(root)
    assert note is not None
    assert "arbor" in note
    assert "origin" in note

    import contextlib

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = cli.main(["sync", "--root", str(root), "--show"])
    assert code == 0
    data = json.loads(buf.getvalue().strip())
    assert data["sync_remote"] == "arbor"
    assert data["remote_note"]

    invocations: list[list[str]] = []
    real_git = sync_mod._git

    def spy_git(root_path, args, **kwargs):
        invocations.append(list(args))
        return real_git(root_path, args, **kwargs)

    monkeypatch.setattr(sync_mod, "_git", spy_git)

    (root / "note.md").write_text("# On B\n")
    _commit_all(root, "push to b")
    report = sync_root(root)
    assert report.ok and report.action == "pushed"

    assert any(a[:2] == ["fetch", "arbor"] for a in invocations)
    assert any("arbor" in _git_push_targets(a) for a in invocations)
    assert not any(a[:2] == ["fetch", "origin"] for a in invocations)
    assert not any("origin" in _git_push_targets(a) for a in invocations)
    log_b = _run_git(bare_b, "log", "--oneline").stdout
    assert "push to b" in log_b
    log_a = _run_git(bare_a, "log", "--oneline", check=False)
    assert log_a.returncode != 0 or "push to b" not in (log_a.stdout or "")


def test_origin_alone_is_not_an_arbor_remote(tmp_path: Path):
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = tmp_path / "solo"
    subprocess.run(["git", "clone", "-q", str(bare), str(root)], check=True)
    _run_git(root, "config", "user.email", "solo@test.local")
    _run_git(root, "config", "user.name", "Solo")

    assert sync_remote_name(root) is None
    assert remote_url(root) is None
    assert remote_note(root) is None


def test_normalize_remote_url_treats_git_suffix_as_equal(tmp_path: Path):
    root = tmp_path / "repo"
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    _run_git(root, "remote", "add", "origin", "https://example.com/lib")
    _run_git(root, "remote", "add", "arbor", "https://example.com/lib.git")
    assert sync_remote_name(root) == "origin"
    assert remote_note(root) is None


def test_sync_show(tmp_path: Path):
    import contextlib

    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = tmp_path / "solo"
    subprocess.run(["git", "clone", "-q", str(bare), str(root)], check=True)
    _run_git(root, "config", "user.email", "solo@test.local")
    _run_git(root, "config", "user.name", "Solo")
    set_remote(root, str(bare))
    set_shared(root, True)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = cli.main(["sync", "--root", str(root), "--show"])
    assert code == 0
    data = json.loads(buf.getvalue().strip())
    assert data["remote"] == str(bare)
    assert data["shared"] is True

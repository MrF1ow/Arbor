from __future__ import annotations

import io
import json
import contextlib
import subprocess
import threading
from datetime import timedelta
from pathlib import Path

import pytest

from arbor_worker import cli
from arbor_worker.gitstate import _is_viewer_own_progress_path, commit_batch, git_user_dirname
from arbor_worker.library import VIEWER_WRITE_DENIED, LibraryError
import arbor_worker.machine as machine_module
from arbor_worker.machine import _is_canonical_uuid, existing_machine_id, machine_id
from arbor_worker.study_progress import (
    APPLIED_WRITE_IDS_MAX,
    history_file_path,
    history_rel_path,
    parse_utc_now,
    study_progress_grade,
    validate_course_name,
)
from tests.ui_overhaul_fixtures import (
    assert_local_ignore_patterns_in_info_exclude,
    build_ui_overhaul_root,
)

CLOCK = parse_utc_now("2026-11-10T12:00:00Z")


def _run_git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
        check=True,
    )


def _run_cli(argv: list[str]) -> tuple[int, str, str]:
    out = io.StringIO()
    err = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def _course_dir(root: Path, course: str) -> Path:
    path = root / course
    (path / "study").mkdir(parents=True, exist_ok=True)
    return path


def _write_deck(root: Path, course: str, card_id: str = "fc_1") -> None:
    payload = {
        "schema_version": 1,
        "course": course,
        "cards": [
            {
                "id": card_id,
                "front": "Q",
                "back": "A",
                "source": {"digest": "digests/a.md", "heading": "Cells"},
            }
        ],
    }
    (root / course / "study").mkdir(parents=True, exist_ok=True)
    (root / course / "study" / "flashcards.json").write_text(
        json.dumps(payload) + "\n",
        encoding="utf-8",
    )


def _write_quiz(root: Path, course: str, qid: str = "q_1") -> None:
    payload = {
        "schema_version": 1,
        "course": course,
        "questions": [{"id": qid, "type": "short", "prompt": "P?", "answer": "A"}],
    }
    (root / course / "study").mkdir(parents=True, exist_ok=True)
    (root / course / "study" / "quiz.json").write_text(
        json.dumps(payload) + "\n",
        encoding="utf-8",
    )


def _history_lines(root: Path, course: str) -> list[dict]:
    mid = machine_id(root)
    path = history_file_path(root, course, mid)
    if not path.is_file():
        return []
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def _all_history_lines(root: Path, course: str) -> list[dict]:
    user_dir = git_user_dirname(root)
    history_dir = root / ".arbor" / "users" / user_dir / course / "history"
    if not history_dir.is_dir():
        return []
    rows: list[dict] = []
    for path in sorted(history_dir.glob("*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
    return rows


def test_grade_and_quiz_append_history_and_commit_clean(tmp_path: Path) -> None:
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    _course_dir(root, "Bio")
    _write_deck(root, "Bio")
    _write_quiz(root, "Bio")
    _run_git(root, "add", "Bio/study")
    _run_git(root, "commit", "-q", "-m", "study deck")

    code, out, err = _run_cli(
        [
            "study-progress",
            "--root",
            str(root),
            "--course",
            "Bio",
            "grade",
            "--id",
            "fc_1",
            "--result",
            "mastered",
            "--now",
            "2026-11-10T12:00:00Z",
        ]
    )
    assert code == 0, err
    json.loads(out.strip())
    grade_lines = _history_lines(root, "Bio")
    assert len(grade_lines) == 1
    assert grade_lines[0]["kind"] == "card"
    assert grade_lines[0]["result"] == "mastered"
    assert grade_lines[0]["digest"] == "digests/a.md"

    code, out, err = _run_cli(
        [
            "study-progress",
            "--root",
            str(root),
            "--course",
            "Bio",
            "quiz",
            "--id",
            "q_1",
            "--result",
            "correct",
            "--now",
            "2026-11-10T12:05:00Z",
        ]
    )
    assert code == 0, err
    json.loads(out.strip())
    lines = _history_lines(root, "Bio")
    assert len(lines) == 2
    assert lines[1]["kind"] == "question"
    assert _run_git(root, "status", "--porcelain").stdout.strip() == ""
    rel = history_rel_path(root, "Bio")
    assert _run_git(root, "ls-files", str(rel)).stdout.strip() == str(rel)


def test_viewer_grade_commits_progress_and_history(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tests.test_library_roles import _init_repo, _isolated_git_env, _library_doc

    _isolated_git_env(monkeypatch, tmp_path)
    owner = "owner@test.local"
    viewer = "viewer@test.local"
    root = _init_repo(
        tmp_path,
        viewer,
        with_library=_library_doc(owner=owner, viewer=viewer),
    )
    init_count = len(_run_git(root, "log", "--oneline").stdout.splitlines())
    code, out, err = _run_cli(
        [
            "study-progress",
            "--root",
            str(root),
            "--course",
            "Biology",
            "grade",
            "--id",
            "fc_cli",
            "--result",
            "mastered",
        ]
    )
    assert code == 0, err
    json.loads(out.strip())
    assert len(_run_git(root, "log", "--oneline").stdout.splitlines()) == init_count + 1
    hist = history_rel_path(root, "Biology")
    assert _run_git(root, "ls-files", str(hist)).stdout.strip() == str(hist)
    assert _run_git(root, "status", "--porcelain").stdout.strip() == ""


def test_write_id_replay_after_window_skips_second_history_line(git_repo: Path) -> None:
    _course_dir(git_repo, "Biology")
    _write_deck(git_repo, "Biology", "fc_idem")
    study_progress_grade(
        git_repo,
        "Biology",
        "fc_idem",
        "mastered",
        now=CLOCK,
        write_id="write-once",
    )
    assert len(_history_lines(git_repo, "Biology")) == 1
    for i in range(APPLIED_WRITE_IDS_MAX):
        study_progress_grade(
            git_repo,
            "Biology",
            f"fc_extra_{i}",
            "again",
            now=CLOCK,
            write_id=f"w{i}",
        )
    before = len(_history_lines(git_repo, "Biology"))
    study_progress_grade(
        git_repo,
        "Biology",
        "fc_idem",
        "mastered",
        now=CLOCK,
        write_id="write-once",
    )
    after = _history_lines(git_repo, "Biology")
    assert len(after) == before


def test_stats_splits_this_week_and_last_week(tmp_path: Path) -> None:
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    _course_dir(root, "Bio")
    _write_deck(root, "Bio")
    _write_quiz(root, "Bio")
    now = parse_utc_now("2026-11-10T12:00:00Z")
    study_progress_grade(
        root,
        "Bio",
        "fc_1",
        "mastered",
        now=now,
        write_id="t1",
    )
    study_progress_grade(
        root,
        "Bio",
        "fc_1",
        "wrong",
        now=now - timedelta(days=10),
        write_id="t2",
    )
    from arbor_worker.study_progress import study_progress_quiz

    study_progress_quiz(
        root,
        "Bio",
        "q_1",
        "correct",
        now=now - timedelta(days=3),
        write_id="t3",
    )
    code, out, err = _run_cli(
        [
            "study-progress",
            "--root",
            str(root),
            "--course",
            "Bio",
            "stats",
            "--now",
            "2026-11-10T12:00:00Z",
        ]
    )
    assert code == 0, err
    stats = json.loads(out.strip())
    assert stats["cards"]["this_week"] == {"correct": 1, "total": 1}
    assert stats["cards"]["last_week"] == {"correct": 0, "total": 1}
    assert stats["quiz"]["this_week"] == {"correct": 1, "total": 1}
    assert stats["quiz"]["last_week"] == {"correct": 0, "total": 0}


def test_machine_json_uses_info_exclude_not_gitignore(tmp_path: Path) -> None:
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    gi = root / ".gitignore"
    before = gi.read_text(encoding="utf-8") if gi.is_file() else ""
    machine_id(root)
    assert _run_git(root, "status", "--porcelain").stdout.strip() == ""
    after = gi.read_text(encoding="utf-8") if gi.is_file() else ""
    assert after == before
    assert_local_ignore_patterns_in_info_exclude(root)


def test_viewer_root_without_sync_machine_id_leaves_gitignore_unchanged(
    tmp_path: Path,
) -> None:
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    owner = tmp_path / "owner"
    subprocess.run(["git", "clone", "-q", str(bare), str(owner)], check=True)
    _run_git(owner, "config", "user.email", "owner@test.local")
    _run_git(owner, "config", "user.name", "Owner")
    (owner / "README.md").write_text("init\n")
    _run_git(owner, "add", "README.md")
    _run_git(owner, "commit", "-q", "-m", "init")
    _run_git(owner, "push", "-u", "origin", "HEAD")

    viewer = tmp_path / "viewer"
    subprocess.run(["git", "clone", "-q", str(bare), str(viewer)], check=True)
    _run_git(viewer, "config", "user.email", "viewer@test.local")
    _run_git(viewer, "config", "user.name", "Viewer")
    gi = viewer / ".gitignore"
    before = gi.read_text(encoding="utf-8") if gi.is_file() else ""
    machine_id(viewer)
    assert _run_git(viewer, "status", "--porcelain").stdout.strip() == ""
    after = gi.read_text(encoding="utf-8") if gi.is_file() else ""
    assert after == before
    assert_local_ignore_patterns_in_info_exclude(viewer)


def test_grade_retries_history_after_failed_append(git_repo: Path) -> None:
    _course_dir(git_repo, "Biology")
    _write_deck(git_repo, "Biology", "fc_retry")
    mid = machine_id(git_repo)
    hist_dir = history_file_path(git_repo, "Biology", mid).parent
    hist_dir.mkdir(parents=True, exist_ok=True)
    hist_dir.chmod(0o500)
    try:
        with pytest.raises(OSError):
            study_progress_grade(
                git_repo,
                "Biology",
                "fc_retry",
                "mastered",
                now=CLOCK,
                write_id="hist-retry",
            )
    finally:
        hist_dir.chmod(0o700)
    doc = study_progress_grade(
        git_repo,
        "Biology",
        "fc_retry",
        "mastered",
        now=CLOCK,
        write_id="hist-retry",
    )
    assert doc["cards"]["fc_retry"]["seen"] == 1
    lines = _history_lines(git_repo, "Biology")
    assert len(lines) == 1
    assert lines[0]["write_id"] == "hist-retry"


def test_viewer_commit_rejects_reserved_course_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tests.test_library_roles import _init_repo, _isolated_git_env, _library_doc

    _isolated_git_env(monkeypatch, tmp_path)
    owner = "owner@test.local"
    viewer = "viewer@test.local"
    root = _init_repo(
        tmp_path,
        viewer,
        with_library=_library_doc(owner=owner, viewer=viewer),
    )
    user_dir = git_user_dirname(root)
    deny_paths = [
        Path(f".arbor/users/{user_dir}/local/history/x.jsonl"),
        Path(f".arbor/users/{user_dir}/local/plan_state.json"),
        Path(f".arbor/users/{user_dir}/local/progress.json"),
        Path(f".arbor/users/{user_dir}/chat/history/x.jsonl"),
        Path(f".arbor/users/{user_dir}/chat/plan_state.json"),
    ]
    for rel in deny_paths:
        assert not _is_viewer_own_progress_path(user_dir, rel)
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text("{}\n")
        with pytest.raises(LibraryError, match=VIEWER_WRITE_DENIED):
            commit_batch(root, [rel], "blocked")


def test_machine_json_unreadable_raises(tmp_path: Path) -> None:
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    mid = machine_id(root)
    assert mid
    path = (
        root
        / ".arbor"
        / "users"
        / git_user_dirname(root)
        / "local"
        / "machine.json"
    )
    path.chmod(0o000)
    try:
        with pytest.raises(OSError):
            machine_id(root)
    finally:
        path.chmod(0o600)


def test_study_progress_show_does_not_create_machine_json(tmp_path: Path) -> None:
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    _course_dir(root, "Extra")
    assert existing_machine_id(root) is None
    code, _out, err = _run_cli(
        [
            "study-progress",
            "--root",
            str(root),
            "--course",
            "Extra",
            "show",
        ]
    )
    assert code == 0, err
    assert existing_machine_id(root) is None


def test_reserved_course_names_rejected() -> None:
    for name in ("local", "Local", "chat", "CHAT"):
        with pytest.raises(ValueError, match="reserved name"):
            validate_course_name(name)

    code, _out, err = _run_cli(
        [
            "study-progress",
            "--root",
            "/tmp",
            "--course",
            "Local",
            "show",
        ]
    )
    assert code == 1
    assert "reserved name" in err


def test_machine_id_concurrent_creators_share_id(tmp_path: Path) -> None:
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    results: list[str] = []
    barrier = threading.Barrier(2)

    def worker() -> None:
        barrier.wait()
        results.append(machine_id(root))

    t1 = threading.Thread(target=worker)
    t2 = threading.Thread(target=worker)
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    assert len(results) == 2
    assert results[0] == results[1]
    assert _is_canonical_uuid(results[0])


def test_machine_id_simulated_race_reads_winner(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    mpath = (
        root
        / ".arbor"
        / "users"
        / git_user_dirname(root)
        / "local"
        / "machine.json"
    )
    real_read = machine_module._read_machine_id

    def _read_missing_only(p: Path) -> str | None:
        if p.is_file():
            return real_read(p)
        return None

    monkeypatch.setattr(machine_module, "_read_machine_id", _read_missing_only)
    first = machine_id(root)
    second = machine_id(root)
    assert first == second
    assert real_read(mpath) == first


def test_replayed_write_id_dedupes_across_history_files(tmp_path: Path) -> None:
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    _course_dir(root, "Bio")
    _write_deck(root, "Bio")
    study_progress_grade(
        root,
        "Bio",
        "fc_1",
        "mastered",
        now=CLOCK,
        write_id="cross-machine",
    )
    assert len(_all_history_lines(root, "Bio")) == 1
    machine_path = (
        root
        / ".arbor"
        / "users"
        / git_user_dirname(root)
        / "local"
        / "machine.json"
    )
    machine_path.unlink()
    study_progress_grade(
        root,
        "Bio",
        "fc_1",
        "mastered",
        now=CLOCK,
        write_id="cross-machine",
    )
    lines = _all_history_lines(root, "Bio")
    assert len(lines) == 1
    code, out, err = _run_cli(
        [
            "study-progress",
            "--root",
            str(root),
            "--course",
            "Bio",
            "stats",
            "--now",
            "2026-11-10T12:00:00Z",
        ]
    )
    assert code == 0, err
    stats = json.loads(out.strip())
    assert stats["cards"]["this_week"]["total"] == 1


def test_unreadable_history_file_blocks_grade(tmp_path: Path) -> None:
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    _course_dir(root, "Bio")
    _write_deck(root, "Bio")
    mid = machine_id(root)
    path = history_file_path(root, "Bio", mid)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('{"write_id": "blocked"}\n', encoding="utf-8")
    path.chmod(0o200)
    try:
        with pytest.raises(OSError):
            study_progress_grade(
                root,
                "Bio",
                "fc_1",
                "mastered",
                now=CLOCK,
                write_id="blocked",
            )
    finally:
        path.chmod(0o600)


def test_machine_json_non_uuid_replaced(tmp_path: Path) -> None:
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    _course_dir(root, "Bio")
    path = (
        root
        / ".arbor"
        / "users"
        / git_user_dirname(root)
        / "local"
        / "machine.json"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('{"machine_id": "../escaped"}\n', encoding="utf-8")
    mid = machine_id(root)
    assert _is_canonical_uuid(mid)
    history_name = history_file_path(root, "Bio", mid).name
    assert history_name == f"{mid}.jsonl"
    assert ".." not in history_name


def test_study_progress_show_unreadable_machine_json(tmp_path: Path) -> None:
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    _course_dir(root, "Extra")
    machine_id(root)
    path = (
        root
        / ".arbor"
        / "users"
        / git_user_dirname(root)
        / "local"
        / "machine.json"
    )
    path.chmod(0o000)
    try:
        code, _out, err = _run_cli(
            [
                "study-progress",
                "--root",
                str(root),
                "--course",
                "Extra",
                "show",
            ]
        )
        assert code == 1
        assert "study-progress failed" in err
    finally:
        path.chmod(0o600)


def test_torn_history_append_does_not_swallow_the_next_answer(git_repo: Path) -> None:
    from arbor_worker.study_progress import study_progress_stats

    _course_dir(git_repo, "Biology")
    _write_deck(git_repo, "Biology", "fc_torn")
    study_progress_grade(git_repo, "Biology", "fc_torn", "mastered", now=CLOCK, write_id="w1")
    path = history_file_path(git_repo, "Biology", machine_id(git_repo))
    with open(path, "a", encoding="utf-8") as fh:
        fh.write('{"ts":"2026-11-10T11:00:00Z","kind":"card","id":"fc_x","res')
    study_progress_grade(git_repo, "Biology", "fc_torn", "wrong", now=CLOCK, write_id="w2")
    stats = study_progress_stats(git_repo, "Biology", now=CLOCK)
    assert stats["cards"]["this_week"]["total"] == 2
    lines_before = path.read_text(encoding="utf-8").splitlines()
    study_progress_grade(git_repo, "Biology", "fc_torn", "wrong", now=CLOCK, write_id="w2")
    assert path.read_text(encoding="utf-8").splitlines() == lines_before


def test_history_with_invalid_utf8_does_not_block_grades(git_repo: Path) -> None:
    from arbor_worker.study_progress import study_progress_stats

    _course_dir(git_repo, "Biology")
    _write_deck(git_repo, "Biology", "fc_utf")
    study_progress_grade(git_repo, "Biology", "fc_utf", "mastered", now=CLOCK, write_id="u1")
    path = history_file_path(git_repo, "Biology", machine_id(git_repo))
    with open(path, "ab") as fh:
        fh.write(b'{"ts":"2026-11-10T11:00:00Z","heading":"Caf\xc3')
    study_progress_grade(git_repo, "Biology", "fc_utf", "wrong", now=CLOCK, write_id="u2")
    stats = study_progress_stats(git_repo, "Biology", now=CLOCK)
    assert stats["cards"]["this_week"]["total"] == 2

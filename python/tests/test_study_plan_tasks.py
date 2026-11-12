from __future__ import annotations

import contextlib
import io
import json
import subprocess
from pathlib import Path

import pytest

from arbor_worker import cli
from arbor_worker.gitstate import git_user_dirname
from arbor_worker.machine import machine_id
from arbor_worker.sync import set_remote, sync_root
from arbor_worker.provider.fake import FakeProvider
from arbor_worker.study_plan import (
    _build_study_plan_prompt,
    generate_study_plan,
    parse_plan_tasks,
)
from tests.ui_overhaul_fixtures import build_ui_overhaul_root

PLAN = (
    "# Study plan\n\n"
    "## Due cards\n\n"
    "- [ ] Review due flashcards\n"
    "- [ ] Review due flashcards\n\n"
    "## This week\n\n"
    "* [ ] Review due flashcards\n"
    "  - [x] Read unit 2 notes\n"
    "- [ ]   Take   the  quiz \n"
    "Not a task line\n"
)


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True, check=True
    ).stdout


def _run_cli(argv: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def _write_plan(root: Path, course: str, text: str, *, commit: bool = True) -> None:
    path = root / course / "study" / "plan.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    if commit:
        _git(root, "add", "-A")
        _git(root, "commit", "-q", "-m", "plan")


def _status(root: Path, course: str = "Bio") -> dict:
    code, out, err = _run_cli(["study-plan", "--root", str(root), "--course", course, "status"])
    assert code == 0, err
    return json.loads(out.strip())


def _toggle(root: Path, task: str, done: str = "true", course: str = "Bio") -> tuple[int, str, str]:
    return _run_cli(
        ["study-plan", "--root", str(root), "--course", course, "toggle", "--task", task, "--done", done]
    )


def _state_files(root: Path, course: str = "Bio") -> list[Path]:
    d = root / ".arbor" / "users" / git_user_dirname(root) / course / "plan_state"
    return sorted(f for f in d.glob("*.jsonl") if f.is_file()) if d.is_dir() else []


def _state_lines(root: Path, course: str = "Bio") -> list[dict]:
    out: list[dict] = []
    for f in _state_files(root, course):
        out.extend(json.loads(line) for line in f.read_text().splitlines() if line.strip())
    return out


@pytest.fixture
def bio_root(tmp_path: Path) -> Path:
    root = build_ui_overhaul_root(tmp_path).root
    _write_plan(root, "Bio", PLAN)
    return root


def test_parse_assigns_ids_headings_and_text() -> None:
    tasks = parse_plan_tasks(PLAN)
    assert [t["text"] for t in tasks] == [
        "Review due flashcards",
        "Review due flashcards",
        "Review due flashcards",
        "Read unit 2 notes",
        "Take the quiz",
    ]
    ids = [t["id"] for t in tasks]
    assert len(set(ids)) == 5
    assert all(len(i) == 10 and int(i, 16) >= 0 for i in ids)


def test_task_id_is_stable_across_edits_elsewhere() -> None:
    before = parse_plan_tasks(PLAN)
    after = parse_plan_tasks(PLAN.replace("# Study plan", "# Study plan\nExam date: 2026-12-01"))
    assert [t["id"] for t in before] == [t["id"] for t in after]


def test_same_text_under_two_headings_gets_different_ids() -> None:
    tasks = parse_plan_tasks(PLAN)
    assert tasks[0]["id"] != tasks[2]["id"]


def test_toggle_then_status_counts_done_and_leaves_tree_clean(bio_root: Path) -> None:
    status = _status(bio_root)
    assert status["done"] == 0 and status["total"] == 5
    task = status["tasks"][3]["id"]
    code, out, err = _toggle(bio_root, task)
    assert code == 0, err
    assert json.loads(out.strip())["done"] == 1
    after = _status(bio_root)
    assert after["done"] == 1
    assert [t["done"] for t in after["tasks"]] == [False, False, False, True, False]
    assert _git(bio_root, "status", "--porcelain").strip() == ""
    files = _state_files(bio_root)
    assert len(files) == 1 and files[0].suffix == ".jsonl"
    rel = files[0].relative_to(bio_root).as_posix()
    assert _git(bio_root, "ls-files", rel).strip() == rel
    lines = _state_lines(bio_root)
    assert len(lines) == 1
    assert lines[0]["id"] == task and lines[0]["done"] is True and lines[0]["ts"].endswith("Z")
    assert "plan progress" in _git(bio_root, "log", "-1", "--pretty=%s")


def test_toggle_false_clears_the_task_even_within_one_second(bio_root: Path) -> None:
    task = _status(bio_root)["tasks"][0]["id"]
    assert _toggle(bio_root, task)[0] == 0
    assert _toggle(bio_root, task, "false")[0] == 0
    assert [l["done"] for l in _state_lines(bio_root)] == [True, False]
    assert _status(bio_root)["done"] == 0
    assert _git(bio_root, "status", "--porcelain").strip() == ""


def test_idempotent_toggle_adds_no_line_and_no_commit(bio_root: Path) -> None:
    task = _status(bio_root)["tasks"][0]["id"]
    assert _toggle(bio_root, task, "false")[0] == 0  # already not done
    assert _state_lines(bio_root) == []
    assert _toggle(bio_root, task)[0] == 0
    head = _git(bio_root, "rev-parse", "HEAD")
    assert _toggle(bio_root, task)[0] == 0
    assert len(_state_lines(bio_root)) == 1
    assert _git(bio_root, "rev-parse", "HEAD") == head


def test_identical_task_lines_toggle_separately(bio_root: Path) -> None:
    tasks = _status(bio_root)["tasks"]
    first, second = tasks[0], tasks[1]
    assert first["text"] == second["text"] and first["id"] != second["id"]
    assert _toggle(bio_root, first["id"])[0] == 0
    done = [t["done"] for t in _status(bio_root)["tasks"]]
    assert done[:3] == [True, False, False]


def test_unknown_task_id_is_a_clear_error(bio_root: Path) -> None:
    code, _out, err = _toggle(bio_root, "0123456789")
    assert code == 1
    assert "unknown task" in err
    assert _git(bio_root, "status", "--porcelain").strip() == ""


def test_toggle_requires_a_boolean(bio_root: Path) -> None:
    task = _status(bio_root)["tasks"][0]["id"]
    code, _out, _err = _toggle(bio_root, task, "maybe")
    assert code != 0


def test_regenerating_a_plan_keeps_done_tasks(bio_root: Path) -> None:
    task = _status(bio_root)["tasks"][3]
    assert _toggle(bio_root, task["id"])[0] == 0
    regenerated = (
        "# Study plan\n\nNew intro text.\n\n"
        "## Due cards\n\n"
        "- [ ] Review due flashcards\n"
        "- [ ] Review due flashcards\n\n"
        "## This week\n\n"
        "* [ ] Review due flashcards\n"
        "- [ ] Read unit 2 notes\n"
        "- [ ] Take the quiz\n"
    )
    generate_study_plan(bio_root, "Bio", FakeProvider(markdown=regenerated), "fake-model")
    after = _status(bio_root)
    assert [t["done"] for t in after["tasks"]] == [False, False, False, True, False]


def test_no_plan_gives_empty_status_and_toggle_errors(bio_root: Path) -> None:
    (bio_root / "Bio" / "study" / "plan.md").unlink()
    status = _status(bio_root)
    assert status == {"done": 0, "total": 0, "tasks": []}
    code, _out, err = _toggle(bio_root, "0123456789")
    assert code == 1 and err.strip()


def test_malformed_lines_are_skipped_and_unreadable_file_fails_toggle(bio_root: Path) -> None:
    task = _status(bio_root)["tasks"][0]["id"]
    d = bio_root / ".arbor" / "users" / git_user_dirname(bio_root) / "Bio" / "plan_state"
    d.mkdir(parents=True, exist_ok=True)
    (d / "other.jsonl").write_text(
        "{not json\n"
        + json.dumps({"ts": "2026-01-01T00:00:00Z", "id": task, "done": True})
        + "\n[1]\n"
        + json.dumps({"ts": "bad", "id": task, "done": False})
        + "\n",
        encoding="utf-8",
    )
    assert _status(bio_root)["done"] == 1
    # A directory named like a log file is an unreadable entry: status skips it, toggle fails.
    (d / "broken.jsonl").mkdir()
    assert _status(bio_root)["done"] == 1
    other = _status(bio_root)["tasks"][1]["id"]
    code, _out, err = _toggle(bio_root, other)
    assert code == 1 and "plan_state" in err
    assert _toggle(bio_root, other, "false")[0] == 1  # still refused, nothing appended
    assert all(f.name == "other.jsonl" for f in _state_files(bio_root))


def test_latest_ts_wins_and_ties_prefer_done(bio_root: Path) -> None:
    tasks = _status(bio_root)["tasks"]
    a, b = tasks[0]["id"], tasks[1]["id"]
    d = bio_root / ".arbor" / "users" / git_user_dirname(bio_root) / "Bio" / "plan_state"
    d.mkdir(parents=True, exist_ok=True)

    def line(ts: str, tid: str, done: bool) -> str:
        return json.dumps({"ts": ts, "id": tid, "done": done}) + "\n"

    (d / "m1.jsonl").write_text(
        line("2026-01-01T00:00:00Z", a, True) + line("2026-01-01T00:00:05Z", b, False), encoding="utf-8"
    )
    (d / "m2.jsonl").write_text(
        line("2026-01-01T00:00:09Z", a, False) + line("2026-01-01T00:00:05Z", b, True), encoding="utf-8"
    )
    done = {t["id"]: t["done"] for t in _status(bio_root)["tasks"]}
    assert done[a] is False  # later false beats earlier true
    assert done[b] is True  # tie: done wins


def test_invalid_course_is_rejected(bio_root: Path) -> None:
    code, _out, err = _run_cli(["study-plan", "--root", str(bio_root), "--course", "../x", "status"])
    assert code == 1 and err.strip()


def test_viewer_toggles_and_reads_status_without_a_provider(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tests.test_library_roles import _init_repo, _isolated_git_env, _library_doc

    _isolated_git_env(monkeypatch, tmp_path)
    owner, viewer = "owner@test.local", "viewer@test.local"
    root = _init_repo(tmp_path, viewer, with_library=_library_doc(owner=owner, viewer=viewer))
    _write_plan(root, "Bio", PLAN)
    commits = len(_git(root, "log", "--oneline").splitlines())

    # Provider resolution must never be reached.
    import arbor_worker.commands as commands

    def boom(*_a, **_k):
        raise AssertionError("provider resolved")

    monkeypatch.setattr(commands, "_resolve_llm_provider", boom)
    task = _status(root)["tasks"][0]["id"]
    code, _out, err = _toggle(root, task)
    assert code == 0, err
    assert _status(root)["done"] == 1
    assert len(_git(root, "log", "--oneline").splitlines()) == commits + 1
    assert _git(root, "status", "--porcelain").strip() == ""


def test_study_today_reports_plan_progress(bio_root: Path) -> None:
    from arbor_worker.today import study_today

    rows = {r["course"]: r for r in study_today(bio_root)["courses"]}
    assert rows["Bio"]["plan"] == {"done": 0, "total": 5}
    assert rows["Chem"]["plan"] is None
    task = _status(bio_root)["tasks"][0]["id"]
    assert _toggle(bio_root, task)[0] == 0
    rows = {r["course"]: r for r in study_today(bio_root)["courses"]}
    assert rows["Bio"]["plan"] == {"done": 1, "total": 5}


def test_prompt_asks_for_task_lines() -> None:
    prompt = _build_study_plan_prompt(
        course="Bio", exam_date=None, due_count=0, deck_count=0, weak_topics=[]
    )
    assert "- [ ]" in prompt


def test_generation_without_tasks_still_works(bio_root: Path) -> None:
    result = generate_study_plan(
        bio_root, "Bio", FakeProvider(markdown="# Study plan\n\nJust prose.\n"), "m"
    )
    assert result["path"] == "Bio/study/plan.md"
    assert _status(bio_root) == {"done": 0, "total": 0, "tasks": []}


def test_bare_generate_still_works(bio_root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARBOR_FAKE_MD", "# Study plan\n\n## This week\n\n- [ ] One thing\n")
    code, out, err = _run_cli(
        ["study-plan", "--root", str(bio_root), "--course", "Bio", "--provider", "fake"]
    )
    assert code == 0, err
    assert json.loads(out.strip())["path"] == "Bio/study/plan.md"
    assert _status(bio_root)["total"] == 1
    assert _git(bio_root, "status", "--porcelain").strip() == ""


def test_toggle_and_status_reject_generate_only_options(bio_root: Path) -> None:
    task = _status(bio_root)["tasks"][0]["id"]
    for flag, value in (("--provider", "fake"), ("--model", "m"), ("--exam-date", "2026-12-01")):
        for tail in (["status"], ["toggle", "--task", task, "--done", "true"]):
            code, _out, err = _run_cli(
                ["study-plan", "--root", str(bio_root), "--course", "Bio", flag, value, *tail]
            )
            assert code != 0, (flag, tail)
    assert _state_lines(bio_root) == []


def test_fence_closes_only_with_same_char_and_length() -> None:
    md = (
        "# P\n\n"
        "```\n- [ ] in backtick fence\n~~~\n- [ ] still in fence\n```\n"
        "- [ ] after one\n"
        "~~~~\n- [ ] in tilde fence\n~~~\n- [ ] still in tilde fence\n~~~~\n"
        "- [ ] after two\n"
    )
    assert [t["text"] for t in parse_plan_tasks(md)] == ["after one", "after two"]


def test_deeply_indented_line_outside_a_list_is_not_a_task() -> None:
    md = "# P\n\nIntro paragraph\n\n    - [ ] code block, not a task\n\n- [ ] real\n  - [ ] nested\n"
    assert [t["text"] for t in parse_plan_tasks(md)] == ["real", "nested"]


def test_plan_read_error_nulls_only_that_class_plan(
    bio_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import arbor_worker.today as today_mod

    real = today_mod.study_plan_status

    def flaky(root, course):
        if course == "Bio":
            raise OSError("boom")
        return real(root, course)

    monkeypatch.setattr(today_mod, "study_plan_status", flaky)
    rows = {r["course"]: r for r in today_mod.study_today(bio_root)["courses"]}
    assert rows["Bio"]["plan"] is None
    assert not rows["Bio"].get("error")
    assert rows["Bio"]["exam_date"] is not None or "mastery" in rows["Bio"]


def test_parallel_toggles_lose_no_updates(bio_root: Path) -> None:
    import threading

    # A task list long enough for 8 distinct tasks.
    _write_plan(bio_root, "Bio", "# Study plan\n\n" + "".join(f"- [ ] Task {i}\n" for i in range(8)))
    ids = [t["id"] for t in _status(bio_root)["tasks"]]
    assert len(ids) == 8
    results: list[int] = []

    def run(task: str) -> None:
        argv = [
            "study-plan", "--root", str(bio_root), "--course", "Bio",
            "toggle", "--task", task, "--done", "true",
        ]
        results.append(cli.main(argv))

    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        threads = [threading.Thread(target=run, args=(t,)) for t in ids]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    assert results == [0] * 8
    assert _status(bio_root)["done"] == 8
    assert _git(bio_root, "status", "--porcelain").strip() == ""


def _two_machines(tmp_path: Path) -> tuple[Path, Path]:
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    a, b = tmp_path / "a", tmp_path / "b"
    subprocess.run(["git", "clone", "-q", str(bare), str(a)], check=True)
    _git(a, "config", "user.email", "same@test.local")
    _git(a, "config", "user.name", "Same")
    _write_plan(a, "Bio", "# Study plan\n\n- [ ] One\n- [ ] Two\n- [ ] Three\n", commit=False)
    _git(a, "add", "-A")
    _git(a, "commit", "-q", "-m", "init")
    _git(a, "push", "-q", "-u", "origin", "HEAD")
    set_remote(a, str(bare))
    subprocess.run(["git", "clone", "-q", str(bare), str(b)], check=True)
    _git(b, "config", "user.email", "same@test.local")
    _git(b, "config", "user.name", "Same")
    set_remote(b, str(bare))
    return a, b


def test_two_machines_of_one_user_sync_without_conflict(tmp_path: Path) -> None:
    a, b = _two_machines(tmp_path)
    ids = [t["id"] for t in _status(a)["tasks"]]
    assert _toggle(a, ids[0])[0] == 0
    assert _toggle(b, ids[1])[0] == 0
    assert machine_id(a) != machine_id(b)
    assert sync_root(a).ok
    rb = sync_root(b)
    assert rb.ok, rb
    assert sync_root(a).ok
    for root in (a, b):
        assert [t["done"] for t in _status(root)["tasks"]] == [True, True, False]
    # A later false on one machine wins over the earlier true from the other.
    assert _toggle(b, ids[0], "false")[0] == 0
    assert sync_root(b).ok and sync_root(a).ok
    for root in (a, b):
        assert [t["done"] for t in _status(root)["tasks"]] == [False, True, False]
    assert _git(a, "status", "--porcelain").strip() == ""


def test_viewer_allowlist_covers_own_plan_state_logs_only() -> None:
    from arbor_worker.gitstate import _is_viewer_own_progress_path as ok

    me = "viewer@test.local"
    good = Path(f".arbor/users/{me}/Bio/plan_state/m1.jsonl")
    assert ok(me, good)
    assert not ok(me, Path(f".arbor/users/{me}/Bio/plan_state.json"))
    assert not ok(me, Path(f".arbor/users/{me}/Bio/plan_state/m1.json"))
    assert not ok(me, Path(f".arbor/users/{me}/Bio/plan_state/..jsonl/x"))
    assert not ok(me, Path(f".arbor/users/{me}/local/plan_state/m1.jsonl"))
    assert not ok(me, Path(f".arbor/users/{me}/chat/plan_state/m1.jsonl"))
    assert not ok(me, Path(f".arbor/users/other@test.local/Bio/plan_state/m1.jsonl"))

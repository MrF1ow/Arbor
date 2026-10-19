from __future__ import annotations

import io
import json
import contextlib
import subprocess
import threading
import uuid
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import pytest

from arbor_worker import cli
from arbor_worker.recommendations import _load_progress_doc
from arbor_worker.study_progress import (
    StudyProgressError,
    parse_utc_now,
    progress_path,
    study_progress_due,
    study_progress_grade,
    study_progress_quiz,
    study_progress_show,
    study_progress_weak,
)

CLOCK = parse_utc_now("2026-10-17T12:00:00Z")


def _course_dir(root: Path, course: str = "Biology") -> Path:
    path = root / course
    path.mkdir(parents=True, exist_ok=True)
    (path / "study").mkdir(exist_ok=True)
    return path


def _write_deck(root: Path, card_ids: list[str], sources: dict[str, dict] | None = None) -> None:
    cards = []
    for card_id in card_ids:
        src = (sources or {}).get(
            card_id,
            {"digest": "digests/a.md", "heading": "Cells"},
        )
        cards.append(
            {
                "id": card_id,
                "front": f"Q {card_id}",
                "back": f"A {card_id}",
                "source": src,
            }
        )
    payload = {"schema_version": 1, "course": "Biology", "cards": cards}
    (root / "Biology" / "study" / "flashcards.json").write_text(
        json.dumps(payload) + "\n",
        encoding="utf-8",
    )


def _run_cli(argv: list[str]) -> tuple[int, str, str]:
    out = io.StringIO()
    err = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def test_mastered_sm2_lite_new_and_repeat(git_repo: Path):
    _course_dir(git_repo)
    doc = study_progress_grade(
        git_repo, "Biology", "fc_new", "mastered", now=CLOCK,
        digest="digests/a.md", heading="Cells",
    )
    card = doc["cards"]["fc_new"]
    assert card["seen"] == 1
    assert card["correct"] == 1
    assert card["wrong"] == 0
    assert card["ease"] == 2.5
    assert card["interval_days"] == 1
    assert card["due_at"] == "2026-10-18T12:00:00Z"

    doc = study_progress_grade(
        git_repo, "Biology", "fc_new", "mastered", now=CLOCK,
    )
    card = doc["cards"]["fc_new"]
    assert card["interval_days"] == 2.5
    assert card["due_at"] == "2026-10-20T00:00:00Z"


def test_wrong_on_new_card(git_repo: Path):
    _course_dir(git_repo)
    doc = study_progress_grade(
        git_repo, "Biology", "fc_wrong", "wrong", now=CLOCK,
    )
    card = doc["cards"]["fc_wrong"]
    assert card["interval_days"] == 0
    assert card["ease"] == 2.5
    assert card["due_at"] == "2026-10-17T12:10:00Z"
    assert card["wrong"] == 1


def test_again_behavior(git_repo: Path):
    _course_dir(git_repo)
    doc = study_progress_grade(git_repo, "Biology", "fc_again", "again", now=CLOCK)
    assert doc["cards"]["fc_again"]["due_at"] is None
    assert doc["cards"]["fc_again"]["seen"] == 1

    study_progress_grade(
        git_repo, "Biology", "fc_again", "mastered", now=CLOCK,
        digest="d.md", heading="H",
    )
    before = json.loads(progress_path(git_repo, "Biology").read_text())["cards"]["fc_again"]
    doc = study_progress_grade(git_repo, "Biology", "fc_again", "again", now=CLOCK)
    after = doc["cards"]["fc_again"]
    assert after["due_at"] == before["due_at"]
    assert after["interval_days"] == before["interval_days"]
    assert after["seen"] == before["seen"] + 1


def test_mastered_uses_stored_ease(git_repo: Path):
    _course_dir(git_repo)
    path = progress_path(git_repo, "Biology")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Biology",
                "cards": {
                    "fc_ease": {
                        "seen": 2,
                        "correct": 2,
                        "wrong": 0,
                        "due_at": "2026-10-17T12:00:00Z",
                        "interval_days": 1,
                        "ease": 2.0,
                    }
                },
                "questions": {},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    doc = study_progress_grade(git_repo, "Biology", "fc_ease", "mastered", now=CLOCK)
    assert doc["cards"]["fc_ease"]["interval_days"] == 2.0


def test_due_list_order_and_timing(git_repo: Path):
    _course_dir(git_repo)
    _write_deck(git_repo, ["fc_due", "fc_later", "fc_soon", "fc_none", "fc_noentry"])
    path = progress_path(git_repo, "Biology")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Biology",
                "cards": {
                    "fc_due": {
                        "seen": 1,
                        "correct": 1,
                        "wrong": 0,
                        "due_at": "2026-10-17T11:00:00Z",
                        "interval_days": 1,
                        "ease": 2.5,
                    },
                    "fc_later": {
                        "seen": 1,
                        "correct": 1,
                        "wrong": 0,
                        "due_at": "2026-10-18T12:00:00Z",
                        "interval_days": 1,
                        "ease": 2.5,
                    },
                    "fc_soon": {
                        "seen": 1,
                        "correct": 0,
                        "wrong": 1,
                        "due_at": "2026-10-17T12:10:00Z",
                        "interval_days": 0,
                        "ease": 2.5,
                    },
                    "fc_none": {
                        "seen": 0,
                        "correct": 0,
                        "wrong": 0,
                        "due_at": None,
                        "interval_days": 0,
                        "ease": 2.5,
                    },
                },
                "questions": {},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    due = study_progress_due(git_repo, "Biology", now=CLOCK)
    assert due["due_ids"] == ["fc_due", "fc_none", "fc_noentry"]
    assert due["count"] == 3
    assert due["deck_count"] == 5

    later = CLOCK + timedelta(minutes=11)
    due_later = study_progress_due(git_repo, "Biology", now=later)
    assert due_later["due_ids"] == ["fc_due", "fc_soon", "fc_none", "fc_noentry"]


def test_migration_from_legacy(git_repo: Path, git):
    _course_dir(git_repo)
    legacy_dir = git_repo / ".arbor" / "progress"
    legacy_dir.mkdir(parents=True)
    flash_legacy = legacy_dir / "Biology.flashcards.json"
    quiz_legacy = legacy_dir / "Biology.quiz.json"
    flash_legacy.write_text(
        json.dumps({"fc_mig": {"seen": 3, "correct": 2, "wrong": 1}}) + "\n",
        encoding="utf-8",
    )
    quiz_legacy.write_text(
        json.dumps({"q_mig": {"seen": 1, "correct": 0, "wrong": 1}}) + "\n",
        encoding="utf-8",
    )
    flash_bytes_before = flash_legacy.read_bytes()
    quiz_bytes_before = quiz_legacy.read_bytes()

    _write_deck(
        git_repo,
        ["fc_mig"],
        {"fc_mig": {"digest": "digests/a.md", "heading": "Cells"}},
    )
    (git_repo / "Biology" / "study" / "quiz.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Biology",
                "questions": [
                    {
                        "id": "q_mig",
                        "type": "multiple_choice",
                        "prompt": "P?",
                        "choices": ["a", "b", "c", "d"],
                        "answer_index": 0,
                        "explanation": "because",
                        "source": {"digest": "digests/a.md", "heading": "Cells"},
                    }
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )

    doc = study_progress_show(git_repo, "Biology")
    progress = progress_path(git_repo, "Biology")
    assert progress.is_file()
    first_bytes = progress.read_bytes()
    card = doc["cards"]["fc_mig"]
    assert card["seen"] == 3 and card["correct"] == 2 and card["wrong"] == 1
    assert card["due_at"] is None and card["interval_days"] == 0 and card["ease"] == 2.5
    assert doc["questions"]["q_mig"]["wrong"] == 1

    doc2 = study_progress_show(git_repo, "Biology")
    assert progress.read_bytes() == first_bytes
    assert doc2 == doc
    assert flash_legacy.read_bytes() == flash_bytes_before
    assert quiz_legacy.read_bytes() == quiz_bytes_before

    graded = study_progress_grade(git_repo, "Biology", "fc_mig", "mastered", now=CLOCK)
    assert graded["cards"]["fc_mig"]["correct"] == 3
    assert graded["questions"]["q_mig"]["wrong"] == 1


def test_weak_topics_ranking(git_repo: Path):
    _course_dir(git_repo)
    (git_repo / "Biology" / "study" / "concepts.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Biology",
                "nodes": [
                    {
                        "id": "light",
                        "name": "Light reactions",
                        "summary": "Photosynthesis light stage.",
                        "kind": "concept",
                        "sources": [{"digest": "digests/a.md", "heading": "Light"}],
                    },
                    {
                        "id": "fig1",
                        "name": "Diagram",
                        "summary": "Skip figures.",
                        "kind": "figure",
                        "sources": [{"digest": "digests/a.md", "heading": "Light"}],
                    },
                ],
                "edges": [],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    path = progress_path(git_repo, "Biology")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Biology",
                "cards": {
                    "c1": {
                        "seen": 2,
                        "correct": 0,
                        "wrong": 2,
                        "due_at": None,
                        "interval_days": 0,
                        "ease": 2.5,
                        "source": {"digest": "digests/a.md", "heading": "Light"},
                    },
                    "c2": {
                        "seen": 1,
                        "correct": 0,
                        "wrong": 1,
                        "due_at": None,
                        "interval_days": 0,
                        "ease": 2.5,
                        "source": {"digest": "digests/a.md", "heading": "Light"},
                    },
                    "c_ok": {
                        "seen": 2,
                        "correct": 2,
                        "wrong": 0,
                        "due_at": None,
                        "interval_days": 0,
                        "ease": 2.5,
                        "source": {"digest": "digests/a.md", "heading": "Perfect"},
                    },
                    "c_head": {
                        "seen": 2,
                        "correct": 0,
                        "wrong": 2,
                        "due_at": None,
                        "interval_days": 0,
                        "ease": 2.5,
                        "source": {"digest": "digests/b.md", "heading": "Orphan"},
                    },
                },
                "questions": {
                    "q1": {
                        "seen": 1,
                        "correct": 0,
                        "wrong": 1,
                        "source": {"digest": "digests/a.md", "heading": "Light"},
                    }
                },
            }
        )
        + "\n",
        encoding="utf-8",
    )
    for i in range(6):
        study_progress_quiz(
            git_repo,
            "Biology",
            f"extra_{i}",
            "wrong",
            digest="digests/z.md",
            heading=f"Topic{i}",
        )
        study_progress_quiz(
            git_repo,
            "Biology",
            f"extra_{i}",
            "correct",
            digest="digests/z.md",
            heading=f"Topic{i}",
        )

    payload = study_progress_weak(git_repo, "Biology")
    topics = payload["topics"]
    assert len(topics) == 5
    labels = [t["label"] for t in topics]
    assert "Light reactions" in labels
    assert "Orphan" in labels
    assert "Perfect" not in labels
    light = next(t for t in topics if t["concept_id"] == "light")
    assert light["kind"] == "concept"
    assert light["concept_id"] == "light"
    assert light["wrong"] == 4
    assert light["correct"] == 0
    assert light["wrong_rate"] == 1.0
    orphan = next(t for t in topics if t["label"] == "Orphan")
    assert orphan["kind"] == "heading"
    assert orphan["concept_id"] is None
    rates = [t["wrong_rate"] for t in topics]
    assert rates == sorted(rates, reverse=True)


def test_grade_only_touches_progress_json(git_repo: Path, git):
    _course_dir(git_repo)
    (git_repo / "Biology" / "course.md").write_text("# Biology\n")
    g = git(git_repo)
    g("add", "Biology/course.md")
    g("commit", "-q", "-m", "biology course")
    study_progress_grade(
        git_repo, "Biology", "fc_git", "mastered", now=CLOCK,
        digest="digests/a.md", heading="Cells",
    )
    status = g("status", "--porcelain", "-uall")
    assert "?? .arbor/users/test@arbor.local/Biology/progress.json" in status
    assert "?? .arbor/locks/" not in status
    assert g("log", "--oneline", "-1").strip().endswith("biology course")


def test_invalid_progress_not_overwritten(git_repo: Path):
    _course_dir(git_repo)
    path = progress_path(git_repo, "Biology")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('{"schema_version": 99, "course": "Biology", "cards": {}, "questions": {}}\n')
    with pytest.raises(StudyProgressError):
        study_progress_show(git_repo, "Biology")
    assert "99" in path.read_text()


def test_invalid_due_at_not_overwritten(git_repo: Path):
    _course_dir(git_repo)
    path = progress_path(git_repo, "Biology")
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(
        {
            "schema_version": 1,
            "course": "Biology",
            "cards": {
                "c1": {
                    "seen": 0,
                    "correct": 0,
                    "wrong": 0,
                    "due_at": "not-a-date",
                    "interval_days": 0,
                    "ease": 2.5,
                }
            },
            "questions": {},
        }
    )
    path.write_text(body + "\n", encoding="utf-8")
    original = path.read_bytes()
    with pytest.raises(StudyProgressError):
        study_progress_show(git_repo, "Biology")
    assert path.read_bytes() == original
    with pytest.raises(StudyProgressError):
        study_progress_due(git_repo, "Biology", now=CLOCK)
    assert path.read_bytes() == original


def test_due_without_progress_does_not_create_file(git_repo: Path):
    _course_dir(git_repo)
    _write_deck(git_repo, ["fc_a"])
    study_progress_due(git_repo, "Biology", now=CLOCK)
    assert not progress_path(git_repo, "Biology").exists()


def test_cli_study_progress_invalid_course_no_commit(git_repo: Path, git):
    g = git(git_repo)
    log_before = g("log", "--oneline")
    code, out, err = _run_cli(
        [
            "study-progress",
            "--root",
            str(git_repo),
            "--course",
            "../etc",
            "show",
        ]
    )
    assert code == 1
    assert "invalid course name" in err
    assert out == ""
    assert g("log", "--oneline") == log_before


def test_cli_study_progress_show(git_repo: Path):
    _course_dir(git_repo)
    code, out, err = _run_cli(
        [
            "study-progress",
            "--root",
            str(git_repo),
            "--course",
            "Biology",
            "show",
        ]
    )
    assert code == 0
    assert err == ""
    data = json.loads(out.strip())
    assert data["schema_version"] == 1
    assert data["course"] == "Biology"


def test_cli_study_progress_overview(git_repo: Path):
    _course_dir(git_repo)
    code, out, err = _run_cli(
        [
            "study-progress",
            "--root",
            str(git_repo),
            "--course",
            "Biology",
            "overview",
        ]
    )
    assert code == 0
    assert err == ""
    data = json.loads(out.strip())
    assert "due" in data
    assert "weak" in data
    assert "recommend" in data
    assert "due_ids" in data["due"]
    assert "topics" in data["weak"]
    assert "items" in data["recommend"]


def test_cli_study_progress_grade_commits_then_show_is_noop(git_repo: Path, git):
    _course_dir(git_repo)
    g = git(git_repo)
    init_count = len(g("log", "--oneline").splitlines())
    code, out, err = _run_cli(
        [
            "study-progress",
            "--root",
            str(git_repo),
            "--course",
            "Biology",
            "grade",
            "--id",
            "fc_cli",
            "--result",
            "mastered",
            "--digest",
            "digests/a.md",
            "--heading",
            "Cells",
        ]
    )
    assert code == 0
    assert err == ""
    json.loads(out.strip())
    assert g("log", "-1", "--format=%s").strip() == "study: Biology progress"
    assert (
        g("ls-files", ".arbor/users/test@arbor.local/Biology/progress.json").strip()
        == ".arbor/users/test@arbor.local/Biology/progress.json"
    )
    after_grade = len(g("log", "--oneline").splitlines())
    code, out, err = _run_cli(
        [
            "study-progress",
            "--root",
            str(git_repo),
            "--course",
            "Biology",
            "show",
        ]
    )
    assert code == 0
    assert err == ""
    json.loads(out.strip())
    assert len(g("log", "--oneline").splitlines()) == after_grade
    assert after_grade == init_count + 1


def test_quiz_updates_questions(git_repo: Path):
    _course_dir(git_repo)
    doc = study_progress_quiz(git_repo, "Biology", "q1", "wrong")
    assert doc["questions"]["q1"] == {"seen": 1, "correct": 0, "wrong": 1}


def test_grade_write_id_is_idempotent(git_repo: Path):
    _course_dir(git_repo)
    study_progress_grade(
        git_repo,
        "Biology",
        "fc_idem",
        "mastered",
        now=CLOCK,
        write_id="write-once",
    )
    study_progress_grade(
        git_repo,
        "Biology",
        "fc_idem",
        "mastered",
        now=CLOCK,
        write_id="write-once",
    )
    doc = study_progress_show(git_repo, "Biology")
    card = doc["cards"]["fc_idem"]
    assert card["seen"] == 1
    assert card["correct"] == 1


def test_cli_grade_commit_failure_still_exits_zero(git_repo: Path, monkeypatch):
    _course_dir(git_repo)
    from arbor_worker.gitstate import GitStateError

    def boom(*_args, **_kwargs):
        raise GitStateError("dirty tree")

    monkeypatch.setattr("arbor_worker.commands._commit_study_progress_if_dirty", boom)
    code, out, err = _run_cli(
        [
            "study-progress",
            "--root",
            str(git_repo),
            "--course",
            "Biology",
            "grade",
            "--id",
            "fc_commit",
            "--result",
            "again",
            "--write-id",
            "w-commit",
        ]
    )
    assert code == 0
    assert "warning:" in err
    json.loads(out.strip())
    doc = study_progress_show(git_repo, "Biology")
    assert doc["cards"]["fc_commit"]["seen"] == 1


@pytest.mark.parametrize(
    "load_progress",
    [
        lambda root: study_progress_show(root, "Biology"),
        lambda root: study_progress_due(root, "Biology", now=CLOCK),
        lambda root: study_progress_weak(root, "Biology"),
        lambda root: _load_progress_doc(root, "Biology"),
    ],
    ids=["show", "due", "weak", "recommendations_load"],
)
def test_legacy_migration_holds_lock_during_build(
    git_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
    load_progress,
):
    from arbor_worker import study_progress as sp

    _course_dir(git_repo)
    legacy_dir = git_repo / ".arbor" / "progress"
    legacy_dir.mkdir(parents=True)
    (legacy_dir / "Biology.flashcards.json").write_text(
        json.dumps({"fc_mig": {"seen": 2, "correct": 1, "wrong": 1}}) + "\n",
        encoding="utf-8",
    )
    _write_deck(
        git_repo,
        ["fc_mig", "fc_new"],
        {"fc_mig": {"digest": "digests/a.md", "heading": "Cells"}},
    )
    assert not progress_path(git_repo, "Biology").is_file()

    in_legacy_build = threading.Event()
    finish_legacy_build = threading.Event()
    real_build = sp._build_from_legacy

    def blocking_build(root: Path, course: str):
        in_legacy_build.set()
        assert finish_legacy_build.wait(timeout=10)
        return real_build(root, course)

    monkeypatch.setattr(sp, "_build_from_legacy", blocking_build)

    load_errors: list[BaseException] = []
    grade_errors: list[BaseException] = []

    def run_load() -> None:
        try:
            load_progress(git_repo)
        except BaseException as error:
            load_errors.append(error)

    def run_grade() -> None:
        try:
            assert in_legacy_build.wait(timeout=10)
            study_progress_grade(git_repo, "Biology", "fc_new", "mastered", now=CLOCK)
        except BaseException as error:
            grade_errors.append(error)

    load_thread = threading.Thread(target=run_load)
    grade_thread = threading.Thread(target=run_grade)
    load_thread.start()
    grade_thread.start()
    assert in_legacy_build.wait(timeout=10)
    finish_legacy_build.set()
    load_thread.join(timeout=10)
    grade_thread.join(timeout=10)
    assert not load_errors
    assert not grade_errors

    doc = study_progress_show(git_repo, "Biology")
    assert doc["cards"]["fc_mig"]["seen"] == 2
    assert doc["cards"]["fc_new"]["seen"] == 1
    assert doc["cards"]["fc_new"]["correct"] == 1


def test_concurrent_grades_persist_all_entries(git_repo: Path):
    _course_dir(git_repo)
    card_ids = [f"fc_{slot}_{index}" for slot in range(2) for index in range(20)]
    _write_deck(git_repo, card_ids)

    def grade_batch(slot: int) -> None:
        for index in range(20):
            study_progress_grade(
                git_repo,
                "Biology",
                f"fc_{slot}_{index}",
                "mastered",
                now=CLOCK,
            )

    threads = [threading.Thread(target=grade_batch, args=(slot,)) for slot in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    doc = study_progress_show(git_repo, "Biology")
    assert len(doc["cards"]) == 40


def test_write_atomic_temp_names_unique(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    from arbor_worker import study_progress as sp

    counter = {"n": 0}
    captured: list[str] = []
    real_write_text = Path.write_text

    def fake_uuid4():
        counter["n"] += 1
        return type("U", (), {"hex": f"{counter['n']:08x}{'0' * 24}"})()

    def write_text(self, *args, **kwargs):
        if ".tmp-" in self.name:
            captured.append(self.name)
        return real_write_text(self, *args, **kwargs)

    monkeypatch.setattr(sp.uuid, "uuid4", fake_uuid4)
    monkeypatch.setattr(Path, "write_text", write_text)
    target = tmp_path / "progress.json"
    sp._write_atomic(target, '{"a":1}\n')
    sp._write_atomic(target, '{"a":2}\n')
    assert len(captured) == 2
    assert captured[0] != captured[1]
    assert str(threading.get_ident()) in captured[0]
    assert "00000001" in captured[0]
    assert "00000002" in captured[1]

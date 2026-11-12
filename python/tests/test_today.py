from __future__ import annotations

import contextlib
import io
import json
import subprocess
import time
from datetime import timedelta
from pathlib import Path

import pytest

from arbor_worker import cli
from arbor_worker.gitstate import git_user_dirname
from arbor_worker.study_progress import (
    parse_utc_now,
    study_progress_digest_stats,
    study_progress_grade,
    study_progress_quiz,
    study_progress_weak,
)
from arbor_worker.today import study_today
from tests.ui_overhaul_fixtures import (
    assert_local_ignore_patterns_in_info_exclude,
    build_ui_overhaul_root,
)

CLOCK = parse_utc_now("2026-11-10T12:00:00Z")


def _set_tz(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    monkeypatch.setenv("TZ", name)
    time.tzset()


@pytest.fixture(autouse=True)
def _utc_machine_timezone(monkeypatch: pytest.MonkeyPatch):
    """Day counts use the machine's local date: pin it so the tests are deterministic."""
    _set_tz(monkeypatch, "UTC")
    yield
    monkeypatch.undo()
    time.tzset()


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


def _legacy_progress_body(course: str) -> bytes:
    doc = {
        "schema_version": 1,
        "course": course,
        "cards": {
            "fc_legacy": {
                "seen": 1,
                "correct": 0,
                "wrong": 0,
                "ease": 2.5,
                "interval_days": 0,
                "due_at": None,
                "source": {"digest": "digests/legacy.md", "heading": "Legacy"},
            }
        },
        "questions": {},
    }
    return (json.dumps(doc, separators=(",", ":"), sort_keys=True) + "\n").encode()


def _extend_fixture_root(root: Path) -> None:
    empty = root / "Empty"
    empty.mkdir()
    (empty / "digests").mkdir(parents=True, exist_ok=True)

    legacy_course = "Legacy"
    legacy_dir = root / legacy_course
    (legacy_dir / "digests").mkdir(parents=True)
    (legacy_dir / "digests" / "legacy.md").write_text("# Legacy\n", encoding="utf-8")
    study = legacy_dir / "study"
    study.mkdir(parents=True)
    legacy_progress = study / "progress.json"
    legacy_progress.write_bytes(_legacy_progress_body(legacy_course))
    _run_git(root, "add", str(legacy_dir.relative_to(root)))
    _run_git(root, "commit", "-q", "-m", "extra today fixture classes")


@pytest.fixture
def today_root(tmp_path: Path) -> Path:
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    _write_quiz_history(root)
    _extend_fixture_root(root)
    return root


def _write_quiz_history(root: Path) -> None:
    (root / "Bio" / "study" / "quiz.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Bio",
                "questions": [
                    {
                        "id": "q_bio",
                        "type": "short",
                        "prompt": "P?",
                        "answer": "A",
                        "source": {"digest": "digests/intro.md", "heading": "Intro"},
                    }
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    _run_git(root, "add", "Bio/study/quiz.json")
    _run_git(root, "commit", "-q", "-m", "quiz deck for today")
    study_progress_quiz(
        root,
        "Bio",
        "q_bio",
        "correct",
        now=CLOCK - timedelta(days=3),
        digest="digests/intro.md",
        heading="Intro",
        write_id="hist-quiz-this",
    )


I11_COURSE_KEYS = frozenset(
    {
        "course",
        "digest_count",
        "due_ids",
        "deck_count",
        "mastered",
        "mastery",
        "exam_date",
        "days_to_exam",
        "plan",
    }
)


def test_study_today_cli_fixture_and_git_clean(today_root: Path) -> None:
    code, out, err = _run_cli(
        [
            "study-today",
            "--root",
            str(today_root),
            "--now",
            "2026-11-10T12:00:00Z",
        ]
    )
    assert code == 0, err
    payload = json.loads(out.strip())

    assert set(payload) == {"courses", "weak_topics", "quiz_accuracy", "next_exam"}
    assert set(payload["quiz_accuracy"]) == {"this_week", "last_week"}
    assert payload["quiz_accuracy"]["this_week"]["total"] >= 1

    names = {row["course"] for row in payload["courses"]}
    assert names == {"Bio", "Chem", "Empty", "Legacy"}

    for row in payload["courses"]:
        assert set(row) == I11_COURSE_KEYS
        assert row["plan"] is None

    bio = next(row for row in payload["courses"] if row["course"] == "Bio")
    assert bio["digest_count"] == 2
    assert bio["deck_count"] == 2
    assert "fc_due" in bio["due_ids"]
    assert bio["mastered"] == 1
    assert bio["mastery"] == 0.5
    assert bio["exam_date"] == "2026-12-01"
    assert bio["days_to_exam"] == 21

    empty = next(row for row in payload["courses"] if row["course"] == "Empty")
    assert empty["digest_count"] == 0
    assert empty["due_ids"] == []
    assert empty["mastered"] == 0
    assert empty["mastery"] is None

    assert payload["next_exam"] == {
        "course": "Chem",
        "exam_date": "2026-11-20",
        "days_to_exam": 10,
    }

    status = _run_git(today_root, "status", "--porcelain").stdout.strip()
    assert status == ""
    bak = today_root / "Legacy" / "study" / "progress.json.bak"
    assert bak.is_file()
    assert _run_git(today_root, "check-ignore", str(bak.relative_to(today_root))).returncode == 0
    assert_local_ignore_patterns_in_info_exclude(today_root)


def test_digest_stats_mastered_threshold_and_empty_lecture(today_root: Path) -> None:
    stats = study_progress_digest_stats(today_root, "Bio", now=CLOCK)
    digests = stats["digests"]
    assert set(digests) == {"digests/intro.md", "digests/unit-2.md"}
    assert digests["digests/unit-2.md"]["mastered"] == 1
    assert digests["digests/intro.md"]["mastery"] is not None

    code, out, err = _run_cli(
        [
            "study-progress",
            "--root",
            str(today_root),
            "--course",
            "Chem",
            "digest-stats",
            "--now",
            "2026-11-10T12:00:00Z",
        ]
    )
    assert code == 0, err
    chem = json.loads(out.strip())["digests"]
    assert chem["digests/periodic.md"]["cards"] == 0
    assert chem["digests/periodic.md"]["mastery"] is None


def test_study_today_weak_topics_include_course(today_root: Path) -> None:
    _, out, _ = _run_cli(
        [
            "study-today",
            "--root",
            str(today_root),
            "--now",
            "2026-11-10T12:00:00Z",
        ]
    )
    payload = json.loads(out.strip())
    assert payload["weak_topics"]
    for row in payload["weak_topics"]:
        assert {"course", "label", "digest", "heading", "wrong_rate"} <= set(row)


def test_graded_mastered_float_counts_as_mastered(tmp_path: Path) -> None:
    root = tmp_path / "Knowledge"
    root.mkdir(parents=True)
    _run_git(root, "init", "-q")
    _run_git(root, "config", "user.email", "test@arbor.local")
    _run_git(root, "config", "user.name", "Arbor Test")

    course = "Solo"
    course_dir = root / course
    (course_dir / "digests").mkdir(parents=True)
    (course_dir / "digests" / "intro.md").write_text("# Intro\n", encoding="utf-8")
    (course_dir / "study").mkdir()
    (course_dir / "study" / "flashcards.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": course,
                "cards": [
                    {
                        "id": "solo_card",
                        "front": "Q",
                        "back": "A",
                        "source": {"digest": "digests/intro.md", "heading": "Intro"},
                    }
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    _run_git(root, "add", course)
    _run_git(root, "commit", "-q", "-m", "solo deck")

    grade_at = parse_utc_now("2026-11-01T12:00:00Z")
    for i in range(5):
        study_progress_grade(
            root,
            course,
            "solo_card",
            "mastered",
            now=grade_at,
            digest="digests/intro.md",
            heading="Intro",
            write_id=f"grade-mastered-{i}",
        )

    digest = study_progress_digest_stats(root, course, now=CLOCK)
    intro = digest["digests"]["digests/intro.md"]
    assert intro["mastered"] == 1

    payload = study_today(root, now=CLOCK)
    solo = next(row for row in payload["courses"] if row["course"] == course)
    assert solo["mastered"] == 1
    assert solo["mastery"] == 1.0


def _library_doc(*, owner: str, viewer: str) -> dict:
    return {
        "name": "Shared",
        "created_by": owner,
        "members": [
            {"email": owner, "role": "owner"},
            {"email": viewer, "role": "viewer"},
        ],
    }


def test_viewer_study_today_legacy_progress_migration(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
    ):
        monkeypatch.delenv(key, raising=False)

    viewer_email = "viewer@test.local"
    root = tmp_path / "viewer-lib"
    root.mkdir()
    _run_git(root, "init", "-q")
    _run_git(root, "config", "user.email", viewer_email)
    _run_git(root, "config", "user.name", "Viewer")

    lib = root / ".arbor"
    lib.mkdir()
    (lib / "library.json").write_text(json.dumps(_library_doc(owner="owner@test.local", viewer=viewer_email)) + "\n")

    biology = root / "Biology"
    study = biology / "study"
    study.mkdir(parents=True)
    (biology / "digests").mkdir()
    (biology / "digests" / "cells.md").write_text("# Cells\n", encoding="utf-8")
    legacy = study / "progress.json"
    legacy.write_bytes(_legacy_progress_body("Biology"))
    (study / "flashcards.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Biology",
                "cards": [
                    {
                        "id": "fc_legacy",
                        "front": "Q",
                        "back": "A",
                        "source": {"digest": "digests/legacy.md", "heading": "Legacy"},
                    }
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    _run_git(root, "add", ".")
    _run_git(root, "commit", "-q", "-m", "viewer biology legacy")

    now = "2026-11-10T12:00:00Z"
    for _ in range(2):
        code, out, err = _run_cli(["study-today", "--root", str(root), "--now", now])
        assert code == 0, err
        payload = json.loads(out.strip())
        assert any(row["course"] == "Biology" for row in payload["courses"])

    user_dir = git_user_dirname(root)
    migrated = root / ".arbor" / "users" / user_dir / "Biology" / "progress.json"
    assert migrated.is_file()
    # A viewer cannot commit the shared file's removal, so it is restored:
    # the tree stays clean and a later rebase pull is not blocked.
    assert legacy.is_file()

    status = _run_git(root, "status", "--porcelain").stdout
    assert status.strip() == ""


def test_deck_mastery_uses_full_deck_not_progress_only(tmp_path: Path) -> None:
    root = tmp_path / "Knowledge"
    root.mkdir(parents=True)
    _run_git(root, "init", "-q")
    _run_git(root, "config", "user.email", "test@arbor.local")
    _run_git(root, "config", "user.name", "Arbor Test")

    course = "Mix"
    (root / course / "digests").mkdir(parents=True)
    (root / course / "digests" / "intro.md").write_text("# Intro\n", encoding="utf-8")
    (root / course / "study").mkdir()
    (root / course / "study" / "flashcards.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": course,
                "cards": [
                    {
                        "id": "fc_mastered",
                        "front": "M",
                        "back": "A",
                        "source": {"digest": "digests/intro.md", "heading": "Intro"},
                    },
                    {
                        "id": "fc_unreviewed",
                        "front": "U",
                        "back": "A",
                        "source": {"digest": "digests/intro.md", "heading": "Intro"},
                    },
                    {"id": "fc_nosource", "front": "N", "back": "A"},
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    user_dir = git_user_dirname(root)
    prog = root / ".arbor" / "users" / user_dir / course / "progress.json"
    prog.parent.mkdir(parents=True)
    prog.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": course,
                "cards": {
                    "fc_mastered": {
                        "seen": 3,
                        "correct": 3,
                        "wrong": 0,
                        "ease": 2.5,
                        "interval_days": 21,
                        "due_at": "2026-12-01T12:00:00Z",
                        "source": {"digest": "digests/intro.md", "heading": "Intro"},
                    }
                },
                "questions": {},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    _run_git(root, "add", course)
    _run_git(root, "commit", "-q", "-m", "mix deck")

    code, out, err = _run_cli(
        ["study-today", "--root", str(root), "--now", "2026-11-10T12:00:00Z"]
    )
    assert code == 0, err
    mix = next(row for row in json.loads(out.strip())["courses"] if row["course"] == course)
    assert mix["deck_count"] == 3
    assert mix["mastered"] == 1
    assert mix["mastery"] == pytest.approx(1 / 3)
    assert set(mix["due_ids"]) == {"fc_unreviewed", "fc_nosource"}

    digest = study_progress_digest_stats(root, course, now=CLOCK)
    assert digest["digests"]["digests/intro.md"]["cards"] == 2
    assert digest["digests"]["digests/intro.md"]["due"] == 1


def _quiz_wrong(
    root: Path,
    course: str,
    qid: str,
    digest: str,
    heading: str,
    *,
    wrongs: int,
    corrects: int,
) -> None:
    for i in range(wrongs):
        study_progress_quiz(
            root,
            course,
            qid,
            "wrong",
            now=CLOCK - timedelta(hours=i + 1),
            digest=digest,
            heading=heading,
            write_id=f"{qid}-w-{i}",
        )
    for i in range(corrects):
        study_progress_quiz(
            root,
            course,
            qid,
            "correct",
            now=CLOCK - timedelta(hours=50 + i),
            digest=digest,
            heading=heading,
            write_id=f"{qid}-c-{i}",
        )


def test_study_today_weak_topics_merge_before_cap(tmp_path: Path) -> None:
    root = tmp_path / "Knowledge"
    root.mkdir(parents=True)
    _run_git(root, "init", "-q")
    _run_git(root, "config", "user.email", "test@arbor.local")
    _run_git(root, "config", "user.name", "Arbor Test")

    quiz_path = root / "Many" / "study" / "quiz.json"
    quiz_path.parent.mkdir(parents=True)
    (root / "Many" / "digests").mkdir(parents=True)
    headings = [f"H{i}" for i in range(6)]
    questions = []
    for i, heading in enumerate(headings):
        (root / "Many" / "digests" / f"lec-{i}.md").write_text(f"# {heading}\n", encoding="utf-8")
        qid = f"q_{i}"
        questions.append(
            {
                "id": qid,
                "type": "short",
                "prompt": f"P{i}?",
                "answer": "A",
                "source": {"digest": f"digests/lec-{i}.md", "heading": heading},
            }
        )
        _quiz_wrong(root, "Many", qid, f"digests/lec-{i}.md", heading, wrongs=2, corrects=0)

    quiz_path.write_text(
        json.dumps({"schema_version": 1, "course": "Many", "questions": questions}) + "\n",
        encoding="utf-8",
    )

    assert len(study_progress_weak(root, "Many", limit=5)["topics"]) == 5
    assert len(study_progress_weak(root, "Many", limit=None)["topics"]) == 6

    (root / "Chem" / "digests").mkdir(parents=True)
    (root / "Chem" / "digests" / "periodic.md").write_text("# Periodic\n", encoding="utf-8")
    (root / "Chem" / "study").mkdir(parents=True)
    _quiz_wrong(
        root,
        "Chem",
        "q_chem_weak",
        "digests/periodic.md",
        "Periodic",
        wrongs=1,
        corrects=9,
    )
    (root / "Chem" / "study" / "quiz.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Chem",
                "questions": [
                    {
                        "id": "q_chem_weak",
                        "type": "short",
                        "prompt": "P?",
                        "answer": "A",
                        "source": {"digest": "digests/periodic.md", "heading": "Periodic"},
                    }
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )

    payload = study_today(root, now=CLOCK)
    weak = payload["weak_topics"]
    assert len(weak) == 7
    rates = [row["wrong_rate"] for row in weak]
    assert rates == sorted(rates, reverse=True)
    many = [row for row in weak if row["course"] == "Many"]
    assert len(many) == 6


def test_study_today_tolerates_bad_class_and_invalid_folder_name(today_root: Path) -> None:
    bad = today_root / "Bad"
    bad.mkdir()
    (bad / "digests").mkdir()
    (bad / "digests" / "x.md").write_text("# X\n", encoding="utf-8")
    (bad / "study").mkdir()
    user_dir = git_user_dirname(today_root)
    prog = today_root / ".arbor" / "users" / user_dir / "Bad" / "progress.json"
    prog.parent.mkdir(parents=True)
    prog.write_text("not-json", encoding="utf-8")

    invalid = today_root / "foo\\bar"
    invalid.mkdir()

    code, out, err = _run_cli(
        ["study-today", "--root", str(today_root), "--now", "2026-11-10T12:00:00Z"]
    )
    assert code == 0, err
    payload = json.loads(out.strip())
    names = {row["course"] for row in payload["courses"]}
    assert "Bad" in names
    assert "foo\\bar" not in names
    bad_row = next(row for row in payload["courses"] if row["course"] == "Bad")
    assert bad_row["due_ids"] == []
    assert bad_row["mastered"] == 0
    assert bad_row["mastery"] is None
    assert "error" in bad_row
    bio_row = next((row for row in payload["courses"] if row["course"] == "Bio"), None)
    assert bio_row is not None
    assert "error" not in bio_row


def _exam_root(tmp_path: Path) -> Path:
    root = build_ui_overhaul_root(tmp_path).root
    from arbor_worker.course_meta import apply_course_meta_fields

    apply_course_meta_fields(root, "Bio", {"exam_date": "2026-12-01"})
    return root


@pytest.mark.parametrize(
    ("now", "days"),
    [
        # 2026-11-30 19:00 in Los Angeles: the exam is tomorrow locally, though UTC is already 12-01.
        ("2026-12-01T03:00:00Z", 1),
        # 2026-12-01 19:00 in Los Angeles: the exam is today locally.
        ("2026-12-02T03:00:00Z", 0),
    ],
)
def test_study_today_counts_days_from_the_machine_local_date(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, now: str, days: int
) -> None:
    root = _exam_root(tmp_path)
    _set_tz(monkeypatch, "America/Los_Angeles")
    code, out, err = _run_cli(["study-today", "--root", str(root), "--now", now])
    assert code == 0, err
    payload = json.loads(out.strip())
    bio = next(row for row in payload["courses"] if row["course"] == "Bio")
    assert bio["days_to_exam"] == days
    assert payload["next_exam"] is not None
    assert payload["next_exam"]["days_to_exam"] == days


def test_study_today_rejects_unparseable_now_cleanly(today_root: Path) -> None:
    code, out, err = _run_cli(
        ["study-today", "--root", str(today_root), "--now", "garbage"]
    )
    assert code == 1
    assert out == ""
    assert "Traceback" not in err
    assert "--now" in err

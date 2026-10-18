from __future__ import annotations

import inspect
import json
from pathlib import Path

from arbor_worker.recommendations import study_recommendations
from arbor_worker.study_progress import progress_path, study_progress_grade


def _course(root: Path) -> None:
    course = root / "Biology"
    digests = course / "digests"
    digests.mkdir(parents=True)
    (digests / "b.md").write_text("# B\n", encoding="utf-8")
    (digests / "a.md").write_text("# A\n", encoding="utf-8")


def _write_deck(root: Path, card_ids: list[str]) -> None:
    cards = [
        {
            "id": cid,
            "front": f"Q {cid}",
            "back": f"A {cid}",
            "source": {"digest": "digests/a.md", "heading": "H"},
        }
        for cid in card_ids
    ]
    (root / "Biology" / "study").mkdir(parents=True, exist_ok=True)
    (root / "Biology" / "study" / "flashcards.json").write_text(
        json.dumps({"schema_version": 1, "course": "Biology", "cards": cards}) + "\n",
        encoding="utf-8",
    )


def test_no_provider_parameter():
    params = inspect.signature(study_recommendations).parameters
    assert "provider" not in params


def test_due_cards_pluralization(git_repo: Path):
    _course(git_repo)
    _write_deck(git_repo, ["c1", "c2"])
    rec = study_recommendations(git_repo, "Biology")
    due_items = [i for i in rec["items"] if i["kind"] == "due_cards"]
    assert len(due_items) == 1
    assert due_items[0]["label"] == "Review 2 due cards"
    assert due_items[0]["count"] == 2
    assert due_items[0]["view"] == "flashcards"


def test_due_cards_singular(git_repo: Path):
    _course(git_repo)
    _write_deck(git_repo, ["c1"])
    rec = study_recommendations(git_repo, "Biology")
    due = next(i for i in rec["items"] if i["kind"] == "due_cards")
    assert due["label"] == "Review 1 due card"


def test_weakest_topic_is_first_only(git_repo: Path):
    _course(git_repo)
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
                        "source": {"digest": "digests/a.md", "heading": "Second"},
                    },
                    "c2": {
                        "seen": 4,
                        "correct": 0,
                        "wrong": 4,
                        "due_at": None,
                        "interval_days": 0,
                        "ease": 2.5,
                        "source": {"digest": "digests/b.md", "heading": "First"},
                    },
                },
                "questions": {},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    weak = study_recommendations(git_repo, "Biology")
    kinds = [i["kind"] for i in weak["items"]]
    assert kinds.count("weakest_topic") == 1
    topic = next(i for i in weak["items"] if i["kind"] == "weakest_topic")
    assert topic["label"] == "First"


def test_unreviewed_digest_lexicographic(git_repo: Path):
    _course(git_repo)
    rec = study_recommendations(git_repo, "Biology")
    item = next(i for i in rec["items"] if i["kind"] == "unreviewed_digest")
    assert item["digest"] == "digests/a.md"
    assert item["label"] == "Read a.md"
    assert item["heading"] is None


def test_reviewed_digest_skipped(git_repo: Path):
    _course(git_repo)
    _write_deck(git_repo, ["fc1"])
    study_progress_grade(
        git_repo, "Biology", "fc1", "again",
        digest="digests/a.md", heading="H",
    )
    rec = study_recommendations(git_repo, "Biology")
    digests = [i for i in rec["items"] if i["kind"] == "unreviewed_digest"]
    assert len(digests) == 1
    assert digests[0]["digest"] == "digests/b.md"

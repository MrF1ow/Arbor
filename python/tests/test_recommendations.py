from __future__ import annotations

import inspect
import json
from pathlib import Path

from arbor_worker.recommendations import _first_unreviewed_digest, study_recommendations
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


def _manifest_course(root: Path, files: list[tuple[str, str]]) -> None:
    """A course whose manifest maps each digest stem to the source it came from."""
    course = root / "Gastro"
    (course / "digests").mkdir(parents=True)
    records = []
    for stem, source in files:
        (course / "digests" / f"{stem}.md").write_text(f"# {stem}\n", encoding="utf-8")
        records.append({"source_path": f"Gastro/{source}", "digest_file": f"digests/{stem}.md"})
    (course / "arbor-course.json").write_text(
        json.dumps({"version": 2, "records": records}) + "\n", encoding="utf-8"
    )


def _unreviewed(root: Path) -> str:
    rec = study_recommendations(root, "Gastro")
    return next(i for i in rec["items"] if i["kind"] == "unreviewed_digest")["digest"]


def test_same_minute_digests_recommend_the_first_source(git_repo: Path):
    # Source 02 was digested into `T2228-2`, source 01 into `T2228`; plain sorting puts `-2` first.
    _manifest_course(
        git_repo,
        [
            ("2026-11-18T2228-2", "02-peptic-ulcer.pdf"),
            ("2026-11-18T2228", "01-esophageal.pdf"),
        ],
    )
    assert _unreviewed(git_repo) == "digests/2026-11-18T2228.md"


def test_source_order_is_natural_not_alphabetical(git_repo: Path):
    _manifest_course(
        git_repo,
        [
            ("2026-11-18T1001", "10-late.pdf"),
            ("2026-11-18T1002", "9-early.pdf"),
        ],
    )
    assert _unreviewed(git_repo) == "digests/2026-11-18T1002.md"


def test_digests_of_one_source_use_the_stem_number(git_repo: Path):
    _manifest_course(
        git_repo,
        [
            ("2026-11-18T1015-10", "a.pdf"),
            ("2026-11-18T1015-2", "a.pdf"),
            ("2026-11-18T1015", "a.pdf"),
        ],
    )
    assert _unreviewed(git_repo) == "digests/2026-11-18T1015.md"


def test_digests_missing_from_the_manifest_follow_by_stem(git_repo: Path):
    _manifest_course(git_repo, [("2026-11-18T2300", "01-a.pdf")])
    digests = git_repo / "Gastro" / "digests"
    (digests / "2026-11-18T0100-2.md").write_text("# x\n", encoding="utf-8")
    (digests / "2026-11-18T0100.md").write_text("# y\n", encoding="utf-8")
    assert _unreviewed(git_repo) == "digests/2026-11-18T2300.md"
    # Once the manifest digest is reviewed the stranger digests follow, `T0100` before `T0100-2`.
    reviewed = {"digests/2026-11-18T2300.md"}
    assert _first_unreviewed_digest(git_repo, "Gastro", reviewed) == "digests/2026-11-18T0100.md"


def _reviewed_order(root: Path) -> list[str]:
    reviewed: set[str] = set()
    out: list[str] = []
    while (rel := _first_unreviewed_digest(root, "Gastro", reviewed)) is not None:
        out.append(rel)
        reviewed.add(rel)
    return out


def test_date_only_stem_is_not_read_as_a_suffix(git_repo: Path):
    # `2026-09-13` is a whole date, not base `2026-09` with suffix 13.
    stems = ["2026-09-12", "2026-09-12T1015", "2026-09-12T1015-2", "2026-09-13"]
    _manifest_course(git_repo, [(stem, "a.pdf") for stem in reversed(stems)])
    assert _reviewed_order(git_repo) == [f"digests/{stem}.md" for stem in stems]
    # Unmanifested: the same four on disk, no manifest at all.
    (git_repo / "Gastro" / "arbor-course.json").unlink()
    assert _reviewed_order(git_repo) == [f"digests/{stem}.md" for stem in stems]


def test_corrupt_manifest_falls_back_to_stem_order(git_repo: Path):
    _manifest_course(git_repo, [("2026-09-13", "a.pdf"), ("2026-09-12", "b.pdf")])
    (git_repo / "Gastro" / "arbor-course.json").write_text("{not json", encoding="utf-8")
    assert _unreviewed(git_repo) == "digests/2026-09-12.md"


def test_digest_shared_by_two_records_files_under_the_first_record(git_repo: Path):
    # The desktop takes the first manifest record for a digest, so `d1` belongs to `09-b.pdf`.
    course = git_repo / "Gastro"
    (course / "digests").mkdir(parents=True)
    for name in ("d1", "d2"):
        (course / "digests" / f"{name}.md").write_text(f"# {name}\n", encoding="utf-8")
    records = [
        {"source_path": "Gastro/09-b.pdf", "digest_file": "digests/d1.md"},
        {"source_path": "Gastro/05-c.pdf", "digest_file": "digests/d2.md"},
        {"source_path": "Gastro/01-a.pdf", "digest_file": "digests/d1.md"},
    ]
    (course / "arbor-course.json").write_text(json.dumps({"records": records}), encoding="utf-8")
    assert _reviewed_order(git_repo) == ["digests/d2.md", "digests/d1.md"]

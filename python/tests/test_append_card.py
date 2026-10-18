from __future__ import annotations

import io
import json
import contextlib
import subprocess
from pathlib import Path

import pytest

from arbor_worker import cli
from arbor_worker.gitstate import FALLBACK_IDENTITY_NOTICE
from arbor_worker.append_card import append_flashcard
from arbor_worker.schemas.study.flashcards import FlashcardDeck
from arbor_worker.schemas.study.quiz import QuizPack
from arbor_worker.skills.flashcards import card_id
from arbor_worker.study_progress import progress_path, study_progress_due


def _course(root: Path) -> None:
    course = root / "Biology"
    digests = course / "digests"
    digests.mkdir(parents=True)
    (digests / "a.md").write_text("# A\n", encoding="utf-8")


def _deck_path(root: Path) -> Path:
    return root / "Biology" / "study" / "flashcards.json"


def _run_cli(argv: list[str]) -> tuple[int, str, str]:
    out = io.StringIO()
    err = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def test_append_to_existing_deck_preserves_cards(git_repo: Path):
    _course(git_repo)
    existing = {
        "schema_version": 1,
        "course": "Biology",
        "cards": [
            {
                "id": "fc_keep",
                "front": "Keep?",
                "back": "Yes",
                "tags": ["t1"],
                "source": {"digest": "digests/a.md", "heading": "H1"},
            }
        ],
    }
    _deck_path(git_repo).parent.mkdir(parents=True)
    _deck_path(git_repo).write_text(json.dumps(existing, indent=2) + "\n", encoding="utf-8")
    before = _deck_path(git_repo).read_bytes()

    card = append_flashcard(
        git_repo,
        "Biology",
        "New?",
        "New answer",
        "digests/a.md",
        heading="H2",
    )
    after = json.loads(_deck_path(git_repo).read_text())
    assert len(after["cards"]) == 2
    assert after["cards"][0] == existing["cards"][0]
    assert after["cards"][1]["front"] == "New?"
    from arbor_worker.schemas.study.flashcards import CardSource, Flashcard

    expected_id = card_id(
        Flashcard(
            front="New?",
            back="New answer",
            source=CardSource(digest="digests/a.md", heading="H2"),
        )
    )
    assert card["id"] == expected_id
    assert card["id"] == after["cards"][1]["id"]
    assert before != _deck_path(git_repo).read_bytes()


def test_script_stored_literally(git_repo: Path):
    _course(git_repo)
    payload = "<script>alert(1)</script>"
    card = append_flashcard(
        git_repo, "Biology", payload, payload, "digests/a.md",
    )
    assert card["front"] == payload
    assert card["back"] == payload
    stored = json.loads(_deck_path(git_repo).read_text())
    assert stored["cards"][0]["front"] == payload


def test_path_traversal_digest_rejected(git_repo: Path):
    _course(git_repo)
    with pytest.raises(ValueError):
        append_flashcard(git_repo, "Biology", "Q", "A", "digests/../secrets.md")


def test_duplicate_raises_unchanged_bytes(git_repo: Path):
    _course(git_repo)
    append_flashcard(git_repo, "Biology", "Dup?", "A1", "digests/a.md")
    before = _deck_path(git_repo).read_bytes()
    with pytest.raises(ValueError, match="flashcard already exists"):
        append_flashcard(git_repo, "Biology", "Dup?", "A2", "digests/a.md")
    assert _deck_path(git_repo).read_bytes() == before


def test_missing_deck_creates_schema_one(git_repo: Path):
    _course(git_repo)
    append_flashcard(git_repo, "Biology", "Q?", "A", "digests/a.md")
    deck = json.loads(_deck_path(git_repo).read_text())
    assert deck["schema_version"] == 1
    assert deck["course"] == "Biology"
    assert len(deck["cards"]) == 1


def test_progress_not_created_and_new_card_due(git_repo: Path):
    _course(git_repo)
    card = append_flashcard(git_repo, "Biology", "Due?", "A", "digests/a.md")
    assert not progress_path(git_repo, "Biology").exists()
    due = study_progress_due(git_repo, "Biology")
    assert card["id"] in due["due_ids"]


def test_page_round_trip_and_omitted_when_absent(git_repo: Path):
    _course(git_repo)
    card = append_flashcard(
        git_repo, "Biology", "P?", "A", "digests/a.md", page="4-5",
    )
    assert card["source"]["page"] == "4-5"
    raw = json.loads(_deck_path(git_repo).read_text())
    assert raw["cards"][0]["source"]["page"] == "4-5"

    append_flashcard(git_repo, "Biology", "No page?", "A", "digests/a.md")
    raw = json.loads(_deck_path(git_repo).read_text())
    assert "page" not in raw["cards"][1]["source"]


def test_legacy_json_without_page_validates():
    deck = FlashcardDeck.model_validate(
        {
            "schema_version": 1,
            "course": "Biology",
            "cards": [
                {
                    "id": "fc1",
                    "front": "Q?",
                    "back": "A",
                    "source": {"digest": "digests/a.md", "heading": None},
                }
            ],
        }
    )
    assert deck.cards[0].source.page is None
    quiz = QuizPack.model_validate(
        {
            "schema_version": 1,
            "course": "Biology",
            "questions": [
                {
                    "id": "q1",
                    "type": "multiple_choice",
                    "prompt": "P?",
                    "choices": ["a", "b", "c", "d"],
                    "answer_index": 0,
                    "explanation": "e",
                    "source": {"digest": "digests/a.md"},
                }
            ],
        }
    )
    assert quiz.questions[0].source.page is None


def test_append_card_cli(git_repo: Path, git):
    _course(git_repo)
    stray = git_repo / "stray.txt"
    stray.write_text("leave untracked\n", encoding="utf-8")
    code, out, err = _run_cli(
        [
            "append-card",
            "--root",
            str(git_repo),
            "--course",
            "Biology",
            "--front",
            "CLI?",
            "--back",
            "CLI",
            "--digest",
            "digests/a.md",
        ]
    )
    assert code == 0
    assert err == ""
    payload = json.loads(out.strip())
    assert payload["front"] == "CLI?"
    g = git(git_repo)
    assert g("log", "-1", "--format=%s").strip() == "study: Biology flashcard"
    assert (
        g("ls-files", "Biology/study/flashcards.json").strip()
        == "Biology/study/flashcards.json"
    )
    assert g("status", "--porcelain", "stray.txt").strip() == "?? stray.txt"


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


def test_append_card_cli_fallback_identity(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    root = tmp_path / "Knowledge"
    root.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    _course(root)
    code, out, err = _run_cli(
        [
            "append-card",
            "--root",
            str(root),
            "--course",
            "Biology",
            "--front",
            "F?",
            "--back",
            "B",
            "--digest",
            "digests/a.md",
        ]
    )
    assert code == 0
    assert FALLBACK_IDENTITY_NOTICE in err
    payload = json.loads(out.strip())
    assert payload["front"] == "F?"
    author = subprocess.run(
        ["git", "-C", str(root), "log", "-1", "--format=%an <%ae>"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert author == "Arbor <arbor@localhost>"
    email = subprocess.run(
        ["git", "-C", str(root), "config", "--get", "user.email"],
        capture_output=True,
        text=True,
    )
    assert email.returncode != 0 or not (email.stdout or "").strip()

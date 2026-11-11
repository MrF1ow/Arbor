"""Shared knowledge roots for ui-overhaul backend integration tests (extended per phase)."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from arbor_worker.gitstate import git_user_dirname
from arbor_worker.machine import PROGRESS_BAK_GIT_EXCLUDE
from arbor_worker.sync import LOCAL_STATE_GIT_EXCLUDE

# Valid `ARBOR_FAKE_MD` payloads for `generate --skill flashcards|quiz --provider fake`.
FAKE_FLASHCARDS_JSON = json.dumps(
    {
        "schema_version": 1,
        "course": "Bio",
        "cards": [
            {
                "id": "fc_bio_1",
                "front": "What is ATP?",
                "back": "Energy currency of the cell.",
                "tags": ["bio"],
                "source": {"digest": "digests/unit-2.md", "heading": "Metabolism"},
            },
        ],
    }
)

FAKE_QUIZ_JSON = json.dumps(
    {
        "schema_version": 1,
        "course": "Bio",
        "questions": [
            {
                "type": "multiple_choice",
                "prompt": "Where does photosynthesis occur?",
                "choices": ["Mitochondria", "Chloroplast", "Nucleus", "Ribosome"],
                "answer_index": 1,
                "explanation": "Chloroplasts host the light reactions.",
                "source": {"digest": "digests/intro.md", "heading": "Cells"},
            },
        ],
    }
)


def _run_git(root: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-C", str(root), *args],
        check=True,
        capture_output=True,
        text=True,
    )


def _init_knowledge_git(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    _run_git(root, "init", "-q")
    _run_git(root, "config", "user.email", "test@arbor.local")
    _run_git(root, "config", "user.name", "Arbor Test")
    (root / ".gitignore").write_text("_arbor_cache/\n")
    _run_git(root, "add", ".gitignore")
    _run_git(root, "commit", "-q", "-m", "init")


def update_fake_digest_markdown(start: int, end: int) -> str:
    """Page-marked digest body for fake `update` runs (pass as `ARBOR_FAKE_MD`)."""
    body = (
        "# Lecture\n## Overview\nThis is a fake digest overview long enough to validate.\n"
        "## Key Concepts\n- concept\n## Important Details\n- detail\n"
        "## Questions to Review\n- question?\n"
    )
    return (
        f"<!-- arbor-pages:{start}-{end} -->\n"
        f"{body.rstrip()}\n"
        f"<!-- /arbor-pages:{start}-{end} -->\n"
    )


@dataclass(frozen=True)
class UiOverhaulRoot:
    """Paths and constants for a two-class (Bio, Chem) fixture root."""

    root: Path
    fake_flashcards_json: str = FAKE_FLASHCARDS_JSON
    fake_quiz_json: str = FAKE_QUIZ_JSON


def build_ui_overhaul_root(tmp_path: Path) -> UiOverhaulRoot:
    """Knowledge root with Bio/Chem digests, manifest records, and study progress."""
    root = tmp_path / "Knowledge"
    _init_knowledge_git(root)

    for course, digest_name, body in (
        ("Bio", "intro.md", "# Intro\n\nWelcome to biology.\n"),
        ("Bio", "unit-2.md", "# Unit 2\n\nEnzymes catalyze reactions.\n"),
        ("Chem", "periodic.md", "# Periodic Table\n\nElements repeat patterns.\n"),
    ):
        digest_dir = root / course / "digests"
        digest_dir.mkdir(parents=True, exist_ok=True)
        (digest_dir / digest_name).write_text(body)

    bio_manifest = {
        "version": 2,
        "records": [
            {
                "source_path": "Bio/intro.pdf",
                "source_hash": "sha256:intro",
                "page_count": 1,
                "start_page": 1,
                "end_page": 1,
                "digest_file": "digests/intro.md",
                "model_id": "fake",
                "processing_path": "pdf_images",
                "generate_mode": "single",
                "chunk_count": None,
                "digested_at": "2026-10-01T12:00:00+00:00",
                "page_markers_version": 1,
            },
            {
                "source_path": "Bio/Unit 2/lec.pdf",
                "source_hash": "sha256:lec",
                "page_count": 2,
                "start_page": 1,
                "end_page": 2,
                "digest_file": "digests/unit-2.md",
                "model_id": "fake",
                "processing_path": "pdf_images",
                "generate_mode": "single",
                "chunk_count": None,
                "digested_at": "2026-10-02T12:00:00+00:00",
                "page_markers_version": 1,
            },
        ],
        "sources": {},
    }
    (root / "Bio" / "arbor-course.json").write_text(json.dumps(bio_manifest, indent=2) + "\n")

    user_dir = git_user_dirname(root)
    progress_path = root / ".arbor" / "users" / user_dir / "Bio" / "progress.json"
    progress_path.parent.mkdir(parents=True, exist_ok=True)
    progress_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Bio",
                "cards": {
                    "fc_due": {
                        "seen": 1,
                        "correct": 0,
                        "wrong": 1,
                        "ease": 2.5,
                        "interval_days": 0,
                        "due_at": "2026-10-17T12:00:00Z",
                    },
                    "fc_mastered": {
                        "seen": 3,
                        "correct": 3,
                        "wrong": 0,
                        "ease": 2.5,
                        "interval_days": 21,
                        "due_at": "2026-11-07T12:00:00Z",
                    },
                },
                "questions": {},
            },
            indent=2,
        )
        + "\n"
    )

    _run_git(root, "add", ".")
    _run_git(root, "commit", "-q", "-m", "ui-overhaul fixture")
    return UiOverhaulRoot(root=root)


def git_info_exclude_path(root: Path) -> Path:
    proc = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--git-path", "info/exclude"],
        capture_output=True,
        text=True,
        check=True,
    )
    rel = (proc.stdout or "").strip()
    path = Path(rel)
    if not path.is_absolute():
        path = root / path
    return path


def read_git_info_exclude_lines(root: Path) -> list[str]:
    path = git_info_exclude_path(root)
    if not path.is_file():
        return []
    return path.read_text(encoding="utf-8").splitlines()


def assert_local_ignore_patterns_in_info_exclude(root: Path) -> None:
    lines = read_git_info_exclude_lines(root)
    assert LOCAL_STATE_GIT_EXCLUDE in lines
    assert PROGRESS_BAK_GIT_EXCLUDE in lines


def build_ui_overhaul_update_root(
    tmp_path: Path,
    make_pdf: Callable[..., Path],
) -> UiOverhaulRoot:
    """Same git layout as `build_ui_overhaul_root`, but with two pending Bio PDF sources."""
    root = tmp_path / "Knowledge-update"
    _init_knowledge_git(root)

    bio = root / "Bio"
    bio.mkdir(parents=True)
    make_pdf(bio / "intro.pdf", pages=1)
    unit = bio / "Unit 2"
    unit.mkdir(parents=True)
    make_pdf(unit / "lec.pdf", pages=1)

    _run_git(root, "add", ".")
    _run_git(root, "commit", "-q", "-m", "pending sources")
    return UiOverhaulRoot(root=root)

import io
import subprocess
from argparse import Namespace
from pathlib import Path

from prompt_marked_fake import PromptMarkedFake

from arbor_worker.commands import cmd_commit_written, cmd_generate
from arbor_worker.events import EventEmitter, parse_lines
from arbor_worker.pipeline import run_update
from arbor_worker.skills.citations import CitationsSkill

from test_pipeline import GOOD_MD, _settings


def _emitter():
    buf = io.StringIO()
    return EventEmitter(buf), buf


def _head(git_repo: Path) -> str:
    return subprocess.check_output(
        ["git", "-C", str(git_repo), "rev-parse", "HEAD"],
        text=True,
    ).strip()


def test_update_no_commit_then_commit_written(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=1)
    head_before = _head(git_repo)

    em, buf = _emitter()
    res = run_update(
        git_repo,
        "m",
        PromptMarkedFake(GOOD_MD),
        em,
        _settings(),
        commit=False,
    )
    assert res.commit is None
    events = parse_lines(buf.getvalue())
    types = [e["type"] for e in events]
    assert "commit_paths" in types
    assert "committed" not in types
    assert _head(git_repo) == head_before

    commit_paths = next(e for e in events if e["type"] == "commit_paths")["paths"]
    assert any("digests/" in p for p in commit_paths)
    assert "Biology/course.md" in commit_paths
    assert "Biology/arbor-course.json" in commit_paths
    assert ".gitignore" not in commit_paths

    code = cmd_commit_written(
        Namespace(
            root=str(git_repo),
            message="digest: Biology",
            index=False,
            paths=commit_paths,
        )
    )
    assert code == 0
    assert _head(git_repo) != head_before


def test_commit_written_rejects_escape(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=1)
    head_before = _head(git_repo)

    run_update(
        git_repo,
        "m",
        PromptMarkedFake(GOOD_MD),
        EventEmitter(io.StringIO()),
        _settings(),
        commit=False,
    )

    code = cmd_commit_written(
        Namespace(
            root=str(git_repo),
            message="bad",
            index=False,
            paths=["../outside"],
        )
    )
    assert code == 1
    assert _head(git_repo) == head_before


def test_generate_no_commit_citations(git_repo: Path):
    course = git_repo / "Biology"
    digests = course / "digests"
    digests.mkdir(parents=True)
    (digests / "2026-01-01-note.md").write_text(
        "# Note\n## Overview\nLong enough overview text here.\n"
        "## Key Concepts\n- a\n## Important Details\n- b\n## Questions to Review\n- c?\n"
    )
    (course / "arbor-course.json").write_text('{"version":2,"records":[],"sources":{}}\n')
    head_before = _head(git_repo)

    args = Namespace(
        root=str(git_repo),
        course="Biology",
        skill=CitationsSkill.name,
        force=True,
        provider="fake",
        model=None,
        no_commit=True,
    )
    import io
    import sys

    buf = io.StringIO()
    prev = sys.stdout
    sys.stdout = buf
    try:
        code = cmd_generate(args)
    finally:
        sys.stdout = prev
    assert code == 0
    events = parse_lines(buf.getvalue())
    assert "commit_paths" in [e["type"] for e in events]
    assert "committed" not in [e["type"] for e in events]
    assert "skill_done" in [e["type"] for e in events]
    assert _head(git_repo) == head_before

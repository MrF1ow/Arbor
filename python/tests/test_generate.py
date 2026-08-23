from __future__ import annotations

import contextlib
import hashlib
import io
import json
import subprocess
from datetime import datetime
from pathlib import Path

from arbor_worker import cli
from arbor_worker.events import parse_lines


def _write_digest(root: Path, text: str = "# Cells\n\nCells divide.\n") -> Path:
    digest = root / "Biology" / "digests" / "2026-08-15.md"
    digest.parent.mkdir(parents=True)
    digest.write_text(text)
    return digest


def _run_generate(root: Path, *extra: str) -> tuple[int, list[dict]]:
    out = io.StringIO()
    argv = [
        "generate",
        "--root",
        str(root),
        "--course",
        "Biology",
        "--skill",
        "fixture",
        "--provider",
        "fake",
        *extra,
    ]
    with contextlib.redirect_stdout(out):
        code = cli.main(argv)
    return code, parse_lines(out.getvalue())


def _head(root: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"],
        capture_output=True,
        check=True,
        text=True,
    ).stdout.strip()


def test_generate_writes_artifact_manifest_and_commit(
    git_repo: Path, monkeypatch
):
    digest = _write_digest(git_repo)
    monkeypatch.setenv(
        "ARBOR_FAKE_MD",
        '{"skill":"fixture","course":"Biology","ok":true}',
    )

    code, events = _run_generate(git_repo)

    assert code == 0
    artifact_path = git_repo / "Biology" / "study" / "fixture.json"
    artifact_text = artifact_path.read_text()
    assert json.loads(artifact_text) == {
        "skill": "fixture",
        "course": "Biology",
        "ok": True,
    }
    assert artifact_text.endswith("\n")
    assert "\n  " in artifact_text

    manifest = json.loads(
        (git_repo / "Biology" / "study" / "manifest.json").read_text()
    )
    fixture_entry = manifest["artifacts"]["fixture"]
    assert manifest["version"] == 1
    assert fixture_entry["file"] == "fixture.json"
    assert fixture_entry["content_sha256"] == hashlib.sha256(
        digest.read_bytes()
    ).hexdigest()
    datetime.fromisoformat(fixture_entry["generated_at"])

    subject = subprocess.run(
        ["git", "-C", str(git_repo), "log", "-1", "--pretty=%s"],
        capture_output=True,
        check=True,
        text=True,
    ).stdout.strip()
    assert subject == "study: Biology fixture"
    assert "skill_done" in [event["type"] for event in events]

    gitignore = (git_repo / ".gitignore").read_text().splitlines()
    assert ".arbor/progress/" in gitignore
    assert ".arbor/vectors.sqlite" in gitignore


def test_generate_skips_matching_artifact_without_rewriting_or_committing(
    git_repo: Path, monkeypatch
):
    _write_digest(git_repo)
    monkeypatch.setenv(
        "ARBOR_FAKE_MD",
        '{"skill":"fixture","course":"Biology","ok":true}',
    )
    first_code, _ = _run_generate(git_repo)
    assert first_code == 0
    artifact_path = git_repo / "Biology" / "study" / "fixture.json"
    manifest_path = git_repo / "Biology" / "study" / "manifest.json"
    prior_artifact = artifact_path.read_bytes()
    prior_manifest = manifest_path.read_bytes()
    prior_head = _head(git_repo)

    code, events = _run_generate(git_repo)

    assert code == 0
    assert [event["type"] for event in events] == ["skill_stale_skipped"]
    assert artifact_path.read_bytes() == prior_artifact
    assert manifest_path.read_bytes() == prior_manifest
    assert _head(git_repo) == prior_head


def test_generate_force_runs_skill_again(git_repo: Path, monkeypatch):
    _write_digest(git_repo)
    monkeypatch.setenv(
        "ARBOR_FAKE_MD",
        '{"skill":"fixture","course":"Biology","ok":true}',
    )
    first_code, _ = _run_generate(git_repo)
    assert first_code == 0
    prior_head = _head(git_repo)

    code, events = _run_generate(git_repo, "--force")

    assert code == 0
    assert "skill_done" in [event["type"] for event in events]
    assert _head(git_repo) != prior_head


def test_generate_fake_defaults_to_fixture_json(git_repo: Path, monkeypatch):
    _write_digest(git_repo)
    monkeypatch.delenv("ARBOR_FAKE_MD", raising=False)

    code, _ = _run_generate(git_repo)

    assert code == 0
    artifact = json.loads(
        (git_repo / "Biology" / "study" / "fixture.json").read_text()
    )
    assert artifact == {
        "skill": "fixture",
        "course": "Biology",
        "ok": True,
    }


def test_generate_unknown_skill_returns_nonzero(git_repo: Path):
    _write_digest(git_repo)
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = cli.main(
            [
                "generate",
                "--root",
                str(git_repo),
                "--course",
                "Biology",
                "--skill",
                "unknown",
                "--provider",
                "fake",
            ]
        )

    assert code != 0
    assert [event["type"] for event in parse_lines(out.getvalue())] == [
        "skill_failed"
    ]


def test_generate_without_digests_emits_skill_failed(git_repo: Path):
    (git_repo / "Biology").mkdir()

    code, events = _run_generate(git_repo)

    assert code == 1
    assert [event["type"] for event in events] == ["skill_failed"]


def test_generate_invalid_json_leaves_prior_artifact_untouched(
    git_repo: Path, monkeypatch
):
    _write_digest(git_repo)
    artifact_path = git_repo / "Biology" / "study" / "fixture.json"
    artifact_path.parent.mkdir()
    artifact_path.write_bytes(b'{"prior":true}\n')
    prior = artifact_path.read_bytes()
    monkeypatch.setenv("ARBOR_FAKE_MD", "not json")

    code, events = _run_generate(git_repo)

    assert code == 1
    assert [event["type"] for event in events].count("skill_progress") == 2
    assert events[-1]["type"] == "skill_failed"
    assert artifact_path.read_bytes() == prior

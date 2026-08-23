from __future__ import annotations

import contextlib
import io
import json
import math
import sqlite3
import subprocess
from pathlib import Path

from arbor_worker import cli
from arbor_worker.embed import chunk_digest
from arbor_worker.embedder.fake import FakeEmbedder
from arbor_worker.embedder.hashed import HashedNgramEmbedder
from arbor_worker.events import parse_lines


def _write_digest(root: Path, text: str) -> Path:
    digest = root / "Biology" / "digests" / "2026-08-15.md"
    digest.parent.mkdir(parents=True, exist_ok=True)
    digest.write_text(text)
    return digest


def _run_embed(root: Path, *extra: str) -> tuple[int, list[dict]]:
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        code = cli.main(
            ["embed", "--root", str(root), "--provider", "fake", *extra]
        )
    return code, parse_lines(output.getvalue())


def _run_embed_search(root: Path, query: str) -> tuple[int, list[dict]]:
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        code = cli.main(
            [
                "embed-search",
                "--root",
                str(root),
                "--query",
                query,
                "--limit",
                "10",
                "--provider",
                "fake",
            ]
        )
    return code, json.loads(output.getvalue() or "[]")


def _stored_chunks(root: Path) -> list[tuple]:
    with sqlite3.connect(root / ".arbor" / "vectors.sqlite") as connection:
        return connection.execute(
            "SELECT course, path, heading, text, digest_sha256, vector "
            "FROM chunks ORDER BY path, heading, text"
        ).fetchall()


def test_fake_embedder_is_stable_and_unit_length():
    embedder = FakeEmbedder()

    first, repeated, different = embedder.embed(
        ["cellular respiration", "cellular respiration", "photosynthesis"]
    )

    assert first == repeated
    assert first != different
    assert math.isclose(math.sqrt(sum(value * value for value in first)), 1.0)


def test_hashed_embedder_returns_normalized_256_dimension_vectors():
    embedder = HashedNgramEmbedder()

    first, different = embedder.embed(["cell membrane", "tectonic plate"])

    assert len(first) == 256
    assert first != different
    assert math.isclose(math.sqrt(sum(value * value for value in first)), 1.0)


def test_hashed_embedder_splits_on_punctuation():
    embedder = HashedNgramEmbedder()

    spaced, punctuated = embedder.embed(["cell membrane", "cell_membrane"])

    assert spaced == punctuated


def test_chunker_splits_digest_on_level_two_headings():
    chunks = chunk_digest(
        course="Biology",
        path="Biology/digests/2026-08-15.md",
        digest_sha256="digest",
        markdown=(
            "# Cell metabolism\n\n"
            "## Glycolysis\n\nGlucose becomes pyruvate.\n\n"
            "## Citric acid cycle\n\nAcetyl-CoA is oxidized.\n"
        ),
    )

    assert len(chunks) >= 2
    assert {"Glycolysis", "Citric acid cycle"} <= {
        chunk.heading for chunk in chunks
    }


def test_chunker_caps_large_heading_blocks_at_about_500_tokens():
    chunks = chunk_digest(
        course="Biology",
        path="Biology/digests/2026-08-15.md",
        digest_sha256="digest",
        markdown="## Long topic\n\n" + " ".join(f"word-{index}." for index in range(1100)),
    )

    assert len(chunks) == 3
    assert {chunk.heading for chunk in chunks} == {"Long topic"}
    assert all(len(chunk.text.split()) <= 500 for chunk in chunks)


def test_embed_cli_writes_gitignored_vector_store(git_repo: Path):
    _write_digest(
        git_repo,
        "# Metabolism\n\n## Glycolysis\n\nGlucose becomes pyruvate.\n",
    )

    code, events = _run_embed(git_repo)

    assert code == 0
    rows = _stored_chunks(git_repo)
    assert len(rows) == 1
    assert rows[0][0:3] == (
        "Biology",
        "Biology/digests/2026-08-15.md",
        "Glycolysis",
    )
    assert isinstance(json.loads(rows[0][5]), list)
    ignored = subprocess.run(
        ["git", "-C", str(git_repo), "check-ignore", ".arbor/vectors.sqlite"],
        capture_output=True,
        text=True,
    )
    assert ignored.returncode == 0
    status = subprocess.run(
        ["git", "-C", str(git_repo), "status", "--short"],
        capture_output=True,
        check=True,
        text=True,
    ).stdout
    assert "vectors.sqlite" not in status
    assert [event["type"] for event in events] == ["embed_started", "embed_done"]


def test_second_embed_skips_an_unchanged_digest(git_repo: Path):
    _write_digest(
        git_repo,
        "## Glycolysis\n\nGlucose becomes pyruvate.\n",
    )
    first_code, _ = _run_embed(git_repo)
    assert first_code == 0
    before = _stored_chunks(git_repo)

    code, events = _run_embed(git_repo)

    assert code == 0
    assert _stored_chunks(git_repo) == before
    done = events[-1]
    assert done["embedded"] == 0
    assert done["skipped"] == 1


def test_changed_digest_replaces_stale_chunks(git_repo: Path):
    digest = _write_digest(
        git_repo,
        "## Glycolysis\n\nGlucose becomes pyruvate.\n",
    )
    first_code, _ = _run_embed(git_repo)
    assert first_code == 0
    old_sha = _stored_chunks(git_repo)[0][4]
    digest.write_text(
        "## Glycolysis\n\nGlucose yields pyruvate and ATP.\n"
    )

    code, events = _run_embed(git_repo)

    assert code == 0
    rows = _stored_chunks(git_repo)
    assert len(rows) == 1
    assert rows[0][3] == "Glucose yields pyruvate and ATP."
    assert rows[0][4] != old_sha
    assert events[-1]["embedded"] == 1


def test_force_rebuilds_unchanged_digests(git_repo: Path):
    _write_digest(
        git_repo,
        "## Glycolysis\n\nGlucose becomes pyruvate.\n",
    )
    first_code, _ = _run_embed(git_repo)
    assert first_code == 0

    code, events = _run_embed(git_repo, "--force")

    assert code == 0
    assert len(_stored_chunks(git_repo)) == 1
    done = events[-1]
    assert done["embedded"] == 1
    assert done["skipped"] == 0


def test_embed_search_returns_search_hit_shaped_results(git_repo: Path):
    _write_digest(
        git_repo,
        (
            "## Glycolysis\n\nGlucose becomes pyruvate.\n\n"
            "## Photosynthesis\n\nPlants capture light energy.\n"
        ),
    )
    embed_code, _ = _run_embed(git_repo)
    assert embed_code == 0

    code, hits = _run_embed_search(
        git_repo,
        "Glycolysis\n\nGlucose becomes pyruvate.",
    )

    assert code == 0
    assert hits[0] == {
        "course": "Biology",
        "path": "Biology/digests/2026-08-15.md",
        "kind": "digest",
        "title": "Glycolysis",
        "snippet": "Glucose becomes pyruvate.",
        "page_range": None,
        "source_path": None,
    }


def test_embed_search_returns_empty_when_vector_store_is_missing(git_repo: Path):
    code, hits = _run_embed_search(git_repo, "glycolysis")

    assert code == 0
    assert hits == []


def test_embed_failure_emits_failed_event(git_repo: Path):
    digest = _write_digest(git_repo, "## Invalid\n")
    digest.write_bytes(b"\xff")

    code, events = _run_embed(git_repo)

    assert code == 1
    assert [event["type"] for event in events] == [
        "embed_started",
        "embed_failed",
    ]

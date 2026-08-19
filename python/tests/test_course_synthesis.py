from pathlib import Path

import pytest

from arbor_worker.course_synthesis import (
    build_course_index,
    build_course_prompt,
    build_course_toc,
    synthesize_course,
)
from arbor_worker.errors import CourseSynthesisError
from arbor_worker.provider.fake import FakeProvider

GOOD_MD = (
    "# Biology\n## Overview\nThis overview is definitely long enough to pass.\n"
    "## Key Concepts\n- a\n## Important Details\n- b\n## Questions to Review\n- c?\n"
)


def test_prompt_includes_each_digest_in_order():
    prompt = build_course_prompt("Biology", [("2026-08-12.md", "first"), ("2026-09-01.md", "second")])
    assert prompt.index("2026-08-12.md") < prompt.index("2026-09-01.md")
    assert "first" in prompt and "second" in prompt
    assert "Course: Biology" in prompt


def test_prompt_includes_source_rules():
    prompt = build_course_prompt("Biology", [("2026-08-12.md", "first")])
    assert "Source rules:" in prompt
    assert "Do not use LaTeX" in prompt


def test_synthesize_returns_markdown_and_sends_no_images(tmp_path: Path):
    prov = FakeProvider(GOOD_MD)
    out = synthesize_course(
        prov,
        course_name="Biology",
        digests=[("2026-08-12.md", "first")],
        model_id="m",
        cwd=tmp_path,
    )
    assert out.startswith("# Biology")
    assert prov.calls[0].image_paths == []


def test_invalid_markdown_raises(tmp_path: Path):
    prov = FakeProvider("too short")
    with pytest.raises(CourseSynthesisError):
        synthesize_course(
            prov,
            course_name="Biology",
            digests=[("2026-08-12.md", "first")],
            model_id="m",
            cwd=tmp_path,
        )


def test_no_digests_raises(tmp_path: Path):
    with pytest.raises(CourseSynthesisError):
        synthesize_course(
            FakeProvider(GOOD_MD),
            course_name="Biology",
            digests=[],
            model_id="m",
            cwd=tmp_path,
        )


def test_build_course_toc_lists_digest_links():
    out = build_course_toc("Biology", [("2026-08-12.md", "one"), ("2026-09-01.md", "two")])
    assert out.startswith("# Biology")
    assert "## Digests" in out
    assert "[2026-08-12.md](digests/2026-08-12.md)" in out
    assert "[2026-09-01.md](digests/2026-09-01.md)" in out
    assert "(none)" not in out


def test_build_course_index_links_digest_and_copies_overview():
    digest = (
        "<!-- arbor-pages:1-2 -->\n"
        "# Lecture\n"
        "## Overview\nCells divide by mitosis in this long enough overview.\n"
        "## Key Concepts\n- mitosis\n"
        "## Important Details\n- DNA\n"
        "## Questions to Review\n- what is mitosis?\n"
        "<!-- /arbor-pages:1-2 -->\n"
    )
    out = build_course_index("Biology", [("2026-08-19.md", digest)])
    assert out.startswith("# Biology")
    assert "[2026-08-19.md](digests/2026-08-19.md)" in out
    assert "## Overview" in out
    assert "Cells divide by mitosis" in out
    assert "mitosis" in out
    assert "assembling the single study notebook" not in out


def test_build_course_index_requires_one_digest():
    with pytest.raises(CourseSynthesisError):
        build_course_index("Biology", [])


def test_synthesize_accepts_unmarked_course_markdown(tmp_path: Path):
    prov = FakeProvider(GOOD_MD)
    out = synthesize_course(
        prov,
        course_name="Biology",
        digests=[("a.md", "first"), ("b.md", "second")],
        model_id="m",
        cwd=tmp_path,
    )
    assert out.startswith("# Biology")
    assert "arbor-pages" not in out

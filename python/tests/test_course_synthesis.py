from pathlib import Path

import pytest

from arbor_worker.course_synthesis import build_course_prompt, synthesize_course
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

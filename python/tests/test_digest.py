from pathlib import Path

import pytest

from arbor_worker.prepare import PrepareResult
from arbor_worker.digest import build_prompt, validate_digest, DigestError, REQUIRED_SECTIONS


def test_prompt_includes_sections_and_text():
    prep = PrepareResult("pptx_text", text="Photosynthesis converts light.")
    prompt = build_prompt("lecture01.pptx", prep)
    for section in REQUIRED_SECTIONS:
        assert section in prompt
    assert "Photosynthesis converts light." in prompt


def test_prompt_image_mode_mentions_images():
    prep = PrepareResult("pdf_images", image_paths=[Path("p1.png"), Path("p2.png")])
    prompt = build_prompt("lecture01.pdf", prep)
    assert "image" in prompt.lower()
    assert "Photosynthesis" not in prompt  # no text embedded in image mode


def test_validate_accepts_complete_digest():
    md = (
        "# Cell Biology\n"
        "## Overview\nThe cell is the unit of life and this sentence is long enough.\n"
        "## Key Concepts\n- organelles\n"
        "## Important Details\n- mitochondria make ATP\n"
        "## Questions to Review\n- what is ATP?\n"
    )
    validate_digest(md)  # no raise


def test_validate_rejects_missing_section():
    md = "# T\n## Overview\nsomething reasonably long here for the body\n"
    with pytest.raises(DigestError):
        validate_digest(md)


def test_validate_rejects_empty():
    with pytest.raises(DigestError):
        validate_digest("   ")

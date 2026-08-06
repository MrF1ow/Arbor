from __future__ import annotations

from arbor_worker.prepare import PrepareResult

REQUIRED_SECTIONS = ["Overview", "Key Concepts", "Important Details", "Questions to Review"]

_MIN_BODY_CHARS = 40


class DigestError(Exception):
    pass


_TEMPLATE = """You are creating structured study notes from a graduate lecture.

Output ONLY GitHub-flavored Markdown, no preamble or code fences, using exactly these
sections in this order:

# <a concise lecture title>
## Overview
## Key Concepts
## Important Details
## Questions to Review

Guidance:
- Overview: 2-4 sentence summary of the lecture.
- Key Concepts: bulleted list of the main ideas.
- Important Details: specifics, definitions, formulas, and facts worth remembering.
- Questions to Review: 3-6 self-test questions the student should be able to answer.

Source file: {source_name}
"""


def build_prompt(source_name: str, prep: PrepareResult) -> str:
    prompt = _TEMPLATE.format(source_name=source_name)
    if prep.text is not None:
        prompt += (
            "\nThe extracted slide text is below between the markers. Base the notes on it.\n"
            "-----BEGIN SOURCE TEXT-----\n"
            f"{prep.text}\n"
            "-----END SOURCE TEXT-----\n"
        )
    else:
        prompt += (
            f"\n{len(prep.image_paths)} page image(s) are attached to this message. "
            "Read all of them, including any handwritten annotations, and base the notes "
            "on their full content.\n"
        )
    return prompt


def validate_digest(markdown: str) -> None:
    body = markdown.strip()
    if len(body) < _MIN_BODY_CHARS:
        raise DigestError("Digest is empty or too short")
    for section in REQUIRED_SECTIONS:
        if f"## {section}" not in markdown:
            raise DigestError(f"Digest missing required section: {section}")

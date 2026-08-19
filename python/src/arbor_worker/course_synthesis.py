from __future__ import annotations

from pathlib import Path

from arbor_worker.digest import SOURCE_RULES, validate_course_markdown
from arbor_worker.errors import CourseSynthesisError
from arbor_worker.provider.base import CliProvider, ProviderRequest

_COURSE_TEMPLATE = """You are assembling the single study notebook for one university course from
dated digests of that course's material.

Combine the digests below into ONE coherent notebook. Merge duplicate points,
keep the chronological order of the digests, and do not lose important details.
Output ONLY GitHub-flavored Markdown, no preamble or code fences, using exactly
these sections in this order:

# <the course name>
## Overview
## Key Concepts
## Important Details
## Questions to Review

Guidance:
- Overview: 3-6 sentence summary of the course so far.
- Key Concepts: bulleted list of the main ideas across all digests.
- Important Details: specifics, definitions, formulas, and facts worth remembering.
- Questions to Review: 5-10 self-test questions covering the whole course.

""" + SOURCE_RULES + """
Course: {course_name}

The dated digests are below, in order, between markers.
"""


def build_course_prompt(course_name: str, digests: list[tuple[str, str]]) -> str:
    prompt = _COURSE_TEMPLATE.format(course_name=course_name)
    for label, markdown in digests:
        prompt += (
            f"\n-----BEGIN DIGEST {label}-----\n"
            f"{markdown}\n"
            f"-----END DIGEST {label}-----\n"
        )
    return prompt


def build_course_index(course_name: str, digests: list[tuple[str, str]]) -> str:
    if len(digests) != 1:
        raise CourseSynthesisError(f"{course_name}: course index requires exactly one digest")
    label, markdown = digests[0]
    lines = [f"# {course_name}", "", f"See [{label}](digests/{label})."]
    overview = _overview_section(markdown)
    if overview:
        lines.extend(["", "## Overview", overview])
    return "\n".join(lines) + "\n"


def build_course_toc(course_name: str, digests: list[tuple[str, str]]) -> str:
    lines = [f"# {course_name}", "", "## Digests"]
    for label, _markdown in digests:
        lines.append(f"- [{label}](digests/{label})")
    return "\n".join(lines) + "\n"


def synthesize_course(
    provider: CliProvider,
    *,
    course_name: str,
    digests: list[tuple[str, str]],
    model_id: str,
    cwd: Path,
) -> str:
    if not digests:
        raise CourseSynthesisError(f"{course_name}: no digests to synthesize")
    prompt = build_course_prompt(course_name, digests)
    try:
        result = provider.run(ProviderRequest(prompt=prompt, model_id=model_id, cwd=cwd))
        validate_course_markdown(result.markdown)
    except CourseSynthesisError:
        raise
    except Exception as e:
        raise CourseSynthesisError(f"{course_name}: course synthesis failed: {e}")
    return result.markdown


def _overview_section(markdown: str) -> str:
    capturing = False
    lines: list[str] = []
    for line in markdown.splitlines():
        if line.startswith("## Overview"):
            capturing = True
            continue
        if capturing and line.startswith("## "):
            break
        if capturing:
            lines.append(line)
    return "\n".join(lines).strip()

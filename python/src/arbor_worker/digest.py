from __future__ import annotations

from arbor_worker.alignment import PageRange
from arbor_worker.page_markers import parse_markers, wrap_range_body
from arbor_worker.prepare import PrepareResult

REQUIRED_SECTIONS = ["Overview", "Key Concepts", "Important Details", "Questions to Review"]

_MIN_BODY_CHARS = 40

_MARKER_GUIDANCE = """
Wrap your entire output in HTML comment page markers for the source pages covered:
<!-- arbor-pages:START-END -->
(your markdown here)
<!-- /arbor-pages:START-END -->
Use the exact START and END page numbers for this window in both markers.
"""


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


def build_prompt(
    source_name: str,
    prep: PrepareResult,
    *,
    page_start: int = 1,
    page_end: int | None = None,
    image_count: int | None = None,
) -> str:
    prompt = _TEMPLATE.format(source_name=source_name)
    if prep.text is not None:
        prompt += (
            "\nThe extracted slide text is below between the markers. Base the notes on it.\n"
            "-----BEGIN SOURCE TEXT-----\n"
            f"{prep.text}\n"
            "-----END SOURCE TEXT-----\n"
        )
        end = page_end if page_end is not None else page_start
    else:
        count = len(prep.image_paths) if image_count is None else image_count
        end = page_end if page_end is not None else page_start + count - 1
        prompt += (
            f"\n{count} page image(s) are attached to this message. "
            "Read all of them, including any handwritten annotations, and base the notes "
            "on their full content.\n"
        )
        if page_start > 1 or end != page_start + count - 1:
            prompt += (
                f"\nThese images cover pages {page_start}-{end} of the source file. Write notes for "
                "this part only, and do not refer to earlier pages you cannot see.\n"
            )
    prompt += _MARKER_GUIDANCE.replace("START", str(page_start)).replace("END", str(end))
    return prompt


def validate_digest(markdown: str) -> None:
    body = markdown.strip()
    if len(body) < _MIN_BODY_CHARS:
        raise DigestError("Digest is empty or too short")
    for section in REQUIRED_SECTIONS:
        if f"## {section}" not in markdown:
            raise DigestError(f"Digest missing required section: {section}")


def finalize_marked_digest(markdown: str, page_range: PageRange) -> str:
    validate_digest(markdown)
    parsed = parse_markers(markdown)
    if parsed.status == "ok":
        if len(parsed.blocks) != 1:
            raise DigestError("Digest must contain exactly one page marker block")
        if parsed.blocks[0].page_range != page_range:
            raise DigestError(
                f"Digest markers {parsed.blocks[0].page_range.start}-"
                f"{parsed.blocks[0].page_range.end} do not match {page_range.start}-{page_range.end}"
            )
        return markdown if markdown.endswith("\n") else markdown + "\n"
    return wrap_range_body(page_range, markdown)


_CHUNK_TEMPLATE = """You are creating structured study notes from PART of a graduate lecture.

This part covers pages {page_start}-{page_end} of {total_pages}.

{image_count} page image(s) for this part are attached. Read all of them, including
any handwritten annotations, and produce concise structured notes for THIS PART
ONLY, as GitHub-flavored Markdown with these sections:

## Overview
## Key Concepts
## Important Details

Do not invent content from other parts of the lecture. Output only Markdown, no
preamble or code fences.

Source file: {source_name}
"""

_SYNTHESIS_TEMPLATE = """You are assembling final study notes for a single graduate lecture from
ordered notes about consecutive parts of that lecture.

Combine the part notes below into ONE coherent digest. Merge duplicate points,
keep the logical order, and do not lose important details. Output ONLY
GitHub-flavored Markdown, no preamble or code fences, using exactly these
sections in this order:

# <a concise lecture title>
## Overview
## Key Concepts
## Important Details
## Questions to Review

Guidance:
- Overview: 2-4 sentence summary of the whole lecture.
- Key Concepts: bulleted list of the main ideas across all parts.
- Important Details: specifics, definitions, formulas, and facts worth remembering.
- Questions to Review: 3-6 self-test questions covering the whole lecture.

Source file: {source_name}

Wrap the final combined digest in page markers for pages {page_start}-{page_end}:
<!-- arbor-pages:{page_start}-{page_end} -->
...
<!-- /arbor-pages:{page_start}-{page_end} -->

The part notes are below, in order, between markers.
"""


def build_chunk_prompt(
    source_name: str,
    page_start: int,
    page_end: int,
    total_pages: int,
    image_count: int,
) -> str:
    return _CHUNK_TEMPLATE.format(
        source_name=source_name,
        page_start=page_start,
        page_end=page_end,
        total_pages=total_pages,
        image_count=image_count,
    )


def build_synthesis_prompt(
    source_name: str,
    chunk_digests: list[str],
    *,
    page_start: int = 1,
    page_end: int | None = None,
) -> str:
    end = page_end if page_end is not None else page_start
    prompt = _SYNTHESIS_TEMPLATE.format(
        source_name=source_name,
        page_start=page_start,
        page_end=end,
    )
    for i, digest in enumerate(chunk_digests, start=1):
        prompt += (
            f"\n-----BEGIN PART {i}-----\n"
            f"{digest}\n"
            f"-----END PART {i}-----\n"
        )
    return prompt


def build_patch_prompt(source_name: str, page_range: PageRange, existing_body: str) -> str:
    return f"""You are updating one section of structured study notes for a graduate lecture.

Rewrite ONLY the section body for pages {page_range.start}-{page_range.end} of {source_name}.
Output GitHub-flavored Markdown for this section with these sections:

## Overview
## Key Concepts
## Important Details

Do not include page marker comments. Output only the inner section markdown.

Existing section body:
-----BEGIN EXISTING-----
{existing_body.strip()}
-----END EXISTING-----
"""


def validate_chunk_digest(markdown: str) -> None:
    if len(markdown.strip()) < _MIN_BODY_CHARS:
        raise DigestError("Chunk digest is empty or too short")

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from arbor_worker.alignment import PageRange

_OPEN_RE = re.compile(r"^<!--\s*arbor-pages:(\d+)-(\d+)\s*-->\s*$")
_CLOSE_RE = re.compile(r"^<!--\s*/arbor-pages:(\d+)-(\d+)\s*-->\s*$")


@dataclass(frozen=True)
class MarkerBlock:
    page_range: PageRange
    body: str
    start_offset: int
    end_offset: int


@dataclass(frozen=True)
class MarkerParseResult:
    status: Literal["ok", "missing", "malformed"]
    blocks: list[MarkerBlock]
    detail: str | None = None


@dataclass(frozen=True)
class ReplaceResult:
    status: Literal["ok", "missing", "malformed"]
    markdown: str | None = None
    detail: str | None = None


def _range_key(page_range: PageRange) -> str:
    return f"{page_range.start}-{page_range.end}"


def open_marker(page_range: PageRange) -> str:
    return f"<!-- arbor-pages:{_range_key(page_range)} -->"


def close_marker(page_range: PageRange) -> str:
    return f"<!-- /arbor-pages:{_range_key(page_range)} -->"


def wrap_range_body(page_range: PageRange, body: str) -> str:
    body = body.strip("\n")
    return f"{open_marker(page_range)}\n{body}\n{close_marker(page_range)}\n"


def parse_markers(markdown: str) -> MarkerParseResult:
    lines = markdown.splitlines(keepends=True)
    blocks: list[MarkerBlock] = []
    offset = 0
    open_stack: list[tuple[PageRange, int, int]] = []

    for line in lines:
        line_start = offset
        offset += len(line)
        stripped = line.rstrip("\n")

        open_match = _OPEN_RE.match(stripped)
        if open_match:
            page_range = PageRange(int(open_match.group(1)), int(open_match.group(2)))
            open_stack.append((page_range, line_start, offset))
            continue

        close_match = _CLOSE_RE.match(stripped)
        if close_match:
            if not open_stack:
                return MarkerParseResult(
                    "malformed",
                    blocks,
                    detail="close marker without open",
                )
            page_range, block_start, body_start = open_stack.pop()
            close_range = PageRange(int(close_match.group(1)), int(close_match.group(2)))
            if close_range != page_range:
                return MarkerParseResult(
                    "malformed",
                    blocks,
                    detail=f"mismatched marker range {_range_key(page_range)} vs {_range_key(close_range)}",
                )
            body = markdown[body_start:line_start]
            blocks.append(
                MarkerBlock(
                    page_range=page_range,
                    body=body,
                    start_offset=block_start,
                    end_offset=offset,
                )
            )
            continue

    if open_stack:
        return MarkerParseResult("malformed", blocks, detail="unclosed marker block")

    if not blocks:
        return MarkerParseResult("missing", blocks)

    seen: set[tuple[int, int]] = set()
    for block in blocks:
        key = (block.page_range.start, block.page_range.end)
        if key in seen:
            return MarkerParseResult("malformed", blocks, detail="overlapping duplicate marker range")
        seen.add(key)
    return MarkerParseResult("ok", blocks)


def replace_block(markdown: str, page_range: PageRange, new_body: str) -> ReplaceResult:
    parsed = parse_markers(markdown)
    if parsed.status != "ok":
        return ReplaceResult(parsed.status, detail=parsed.detail)

    target = None
    for block in parsed.blocks:
        if block.page_range == page_range:
            target = block
            break
    if target is None:
        return ReplaceResult("missing", detail=f"no marker block for {_range_key(page_range)}")

    replacement = wrap_range_body(page_range, new_body)
    updated = markdown[: target.start_offset] + replacement + markdown[target.end_offset :]
    return ReplaceResult("ok", markdown=updated)

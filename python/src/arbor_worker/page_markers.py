from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

_MARKER_RE = re.compile(r"<!-- (/?)arbor-pages:(\d+)-(\d+) -->")


@dataclass(frozen=True)
class PageRange:
    start: int
    end: int

    def __post_init__(self) -> None:
        if self.start < 1 or self.end < self.start:
            raise ValueError(f"invalid page range {self.start}-{self.end}")


@dataclass(frozen=True)
class MarkerSpan:
    page_range: PageRange
    body: str
    inner_start: int
    inner_end: int


@dataclass(frozen=True)
class ParseResult:
    status: Literal["ok", "malformed"]
    spans: tuple[MarkerSpan, ...] = ()
    reason: str | None = None


@dataclass(frozen=True)
class PatchResult:
    status: Literal["ok", "missing", "malformed"]
    markdown: str | None = None
    reason: str | None = None


def parse_page_markers(markdown: str) -> ParseResult:
    spans: list[MarkerSpan] = []
    open_match: re.Match[str] | None = None

    for match in _MARKER_RE.finditer(markdown):
        is_close = match.group(1) == "/"
        start = int(match.group(2))
        end = int(match.group(3))
        if start < 1 or end < start:
            return ParseResult(status="malformed", reason="invalid page range")

        if not is_close:
            if open_match is not None:
                return ParseResult(status="malformed", reason="nested page markers")
            open_match = match
            continue

        if open_match is None:
            return ParseResult(status="malformed", reason="unmatched close marker")

        open_start = int(open_match.group(2))
        open_end = int(open_match.group(3))
        if (open_start, open_end) != (start, end):
            return ParseResult(status="malformed", reason="mismatched open and close range")

        inner_start = open_match.end()
        inner_end = match.start()
        body = markdown[inner_start:inner_end]
        if body.startswith("\n"):
            body = body[1:]
        if body.endswith("\n"):
            body = body[:-1]
        spans.append(
            MarkerSpan(
                page_range=PageRange(start, end),
                body=body,
                inner_start=inner_start,
                inner_end=inner_end,
            )
        )
        open_match = None

    if open_match is not None:
        return ParseResult(status="malformed", reason="unclosed page marker")

    for i, span in enumerate(spans):
        for other in spans[i + 1 :]:
            if _ranges_overlap(span.page_range, other.page_range):
                return ParseResult(status="malformed", reason="overlapping page ranges")

    return ParseResult(status="ok", spans=tuple(spans))


def replace_page_marker(markdown: str, page_range: PageRange, new_body: str) -> PatchResult:
    parsed = parse_page_markers(markdown)
    if parsed.status == "malformed":
        return PatchResult(status="malformed", reason=parsed.reason)

    for span in parsed.spans:
        if span.page_range != page_range:
            continue
        replacement = "\n" + new_body.rstrip("\n") + "\n"
        updated = markdown[: span.inner_start] + replacement + markdown[span.inner_end :]
        return PatchResult(status="ok", markdown=updated)

    return PatchResult(status="missing")


def _ranges_overlap(left: PageRange, right: PageRange) -> bool:
    return not (left.end < right.start or right.end < left.start)

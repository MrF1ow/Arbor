from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from arbor_worker.alignment import PageRange
from arbor_worker.page_markers import parse_markers


@dataclass(frozen=True)
class CreateAction:
    kind: Literal["create"] = "create"
    page_range: PageRange = PageRange(1, 1)


@dataclass(frozen=True)
class PatchAction:
    kind: Literal["patch"] = "patch"
    digest_file: str = ""
    page_range: PageRange = PageRange(1, 1)


@dataclass(frozen=True)
class RegenerateAction:
    kind: Literal["regenerate"] = "regenerate"
    digest_file: str = ""
    page_range: PageRange = PageRange(1, 1)


DigestAction = CreateAction | PatchAction | RegenerateAction


def ranges_overlap(a: PageRange, b: PageRange) -> bool:
    return a.start <= b.end and b.start <= a.end


def range_intersection(a: PageRange, b: PageRange) -> PageRange | None:
    if not ranges_overlap(a, b):
        return None
    return PageRange(max(a.start, b.start), min(a.end, b.end))


def record_page_range(record: dict) -> PageRange:
    return PageRange(int(record["start_page"]), int(record["end_page"]))


def digest_coverage(course_dir: Path, record: dict) -> PageRange:
    digest_path = course_dir / record["digest_file"]
    if digest_path.is_file():
        parsed = parse_markers(digest_path.read_text())
        if parsed.status == "ok" and parsed.blocks:
            starts = [b.page_range.start for b in parsed.blocks]
            ends = [b.page_range.end for b in parsed.blocks]
            return PageRange(min(starts), max(ends))
    return record_page_range(record)


def classify_digest_actions(
    course_dir: Path,
    source_path: str,
    page_range: PageRange,
    records: list[dict],
) -> list[DigestAction]:
    owning = [r for r in records if r.get("source_path") == source_path]
    overlapping: list[tuple[dict, PageRange]] = []
    for record in owning:
        coverage = digest_coverage(course_dir, record)
        intersection = range_intersection(page_range, coverage)
        if intersection is not None:
            overlapping.append((record, intersection))

    if not overlapping:
        return [CreateAction(page_range=page_range)]

    actions: list[DigestAction] = []
    matched_parts: list[PageRange] = []
    for record, intersection in overlapping:
        digest_file = record["digest_file"]
        digest_path = course_dir / digest_file
        parsed = parse_markers(digest_path.read_text()) if digest_path.is_file() else None
        coverage = digest_coverage(course_dir, record)

        if parsed is None or parsed.status != "ok":
            actions.append(
                RegenerateAction(digest_file=digest_file, page_range=coverage)
            )
            matched_parts.append(intersection)
            continue

        if intersection == coverage:
            actions.append(
                RegenerateAction(digest_file=digest_file, page_range=coverage)
            )
        else:
            actions.append(
                PatchAction(digest_file=digest_file, page_range=intersection)
            )
        matched_parts.append(intersection)

    cursor = page_range.start
    for intersection in sorted(matched_parts, key=lambda r: r.start):
        if intersection.start > cursor:
            actions.insert(
                0,
                CreateAction(page_range=PageRange(cursor, intersection.start - 1)),
            )
        cursor = max(cursor, intersection.end + 1)
    if cursor <= page_range.end:
        actions.append(CreateAction(page_range=PageRange(cursor, page_range.end)))

    return actions

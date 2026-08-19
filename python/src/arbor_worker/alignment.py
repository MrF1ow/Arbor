from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence

AlignmentStatus = Literal["clean_append", "changed", "ambiguous", "identical"]

_MATCH_FRACTION_THRESHOLD = 0.8


@dataclass(frozen=True)
class PageRange:
    start: int
    end: int


@dataclass(frozen=True)
class AlignmentResult:
    status: AlignmentStatus
    suggested_ranges: list[PageRange]
    matched_fraction: float


def align_fingerprints(
    stored: Sequence[str],
    current: Sequence[str],
) -> AlignmentResult:
    stored_fps = list(stored)
    current_fps = list(current)
    n = len(stored_fps)
    m = len(current_fps)

    if stored_fps == current_fps:
        return AlignmentResult("identical", [], 1.0)

    if m > n and current_fps[:n] == stored_fps:
        return AlignmentResult("clean_append", [PageRange(n + 1, m)], 1.0)

    lcs_len, participating = _lcs_current_participation(stored_fps, current_fps)
    matched_fraction = (lcs_len / n) if n else 1.0
    unique = sum(1 for used in participating if used) == lcs_len

    if matched_fraction < _MATCH_FRACTION_THRESHOLD or not unique:
        return AlignmentResult("ambiguous", [], matched_fraction)

    dirty = [j + 1 for j, used in enumerate(participating) if not used]
    return AlignmentResult("changed", _merge_ranges(dirty), matched_fraction)


def _lcs_current_participation(
    stored: list[str],
    current: list[str],
) -> tuple[int, list[bool]]:
    n = len(stored)
    m = len(current)
    prefix = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        si = stored[i - 1]
        row = prefix[i]
        prev = prefix[i - 1]
        for j in range(1, m + 1):
            if si == current[j - 1]:
                row[j] = prev[j - 1] + 1
            else:
                row[j] = prev[j] if prev[j] >= row[j - 1] else row[j - 1]

    suffix = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        si = stored[i]
        row = suffix[i]
        nxt = suffix[i + 1]
        for j in range(m - 1, -1, -1):
            if si == current[j]:
                row[j] = nxt[j + 1] + 1
            else:
                row[j] = nxt[j] if nxt[j] >= row[j + 1] else row[j + 1]

    lcs_len = prefix[n][m]
    participating = [False] * m
    for j, cj in enumerate(current):
        for i, si in enumerate(stored):
            if si != cj:
                continue
            if prefix[i][j] + 1 + suffix[i + 1][j + 1] == lcs_len:
                participating[j] = True
                break
    return lcs_len, participating


def _merge_ranges(pages: list[int]) -> list[PageRange]:
    if not pages:
        return []
    ranges: list[PageRange] = []
    start = prev = pages[0]
    for page in pages[1:]:
        if page == prev + 1:
            prev = page
            continue
        ranges.append(PageRange(start, prev))
        start = prev = page
    ranges.append(PageRange(start, prev))
    return ranges

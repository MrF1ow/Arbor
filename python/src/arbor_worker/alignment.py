from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

AlignmentStatus = Literal["clean_append", "changed", "ambiguous", "identical"]


@dataclass(frozen=True)
class PageRange:
    start: int
    end: int

    def __post_init__(self) -> None:
        if self.start < 1 or self.end < self.start:
            raise ValueError(f"invalid page range {self.start}-{self.end}")


@dataclass(frozen=True)
class AlignmentResult:
    status: AlignmentStatus
    suggested_ranges: list[PageRange]
    matched_fraction: float


def _ranges_from_indices(indices: list[int]) -> list[PageRange]:
    if not indices:
        return []
    sorted_idx = sorted(indices)
    ranges: list[PageRange] = []
    start = sorted_idx[0]
    prev = sorted_idx[0]
    for idx in sorted_idx[1:]:
        if idx == prev + 1:
            prev = idx
            continue
        ranges.append(PageRange(start, prev))
        start = idx
        prev = idx
    ranges.append(PageRange(start, prev))
    return ranges


def _lcs_pairs(old: list[str], new: list[str]) -> list[tuple[int, int]]:
  m, n = len(old), len(new)
  dp = [[0] * (n + 1) for _ in range(m + 1)]
  for i in range(1, m + 1):
      for j in range(1, n + 1):
          if old[i - 1] == new[j - 1]:
              dp[i][j] = dp[i - 1][j - 1] + 1
          else:
              dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])

  pairs: list[tuple[int, int]] = []
  i, j = m, n
  while i > 0 and j > 0:
      if old[i - 1] == new[j - 1]:
          pairs.append((i - 1, j - 1))
          i -= 1
          j -= 1
      elif dp[i - 1][j] >= dp[i][j - 1]:
          i -= 1
      else:
          j -= 1
  pairs.reverse()
  return pairs


def _count_max_lcs_alignments(old: list[str], new: list[str]) -> int:
    m, n = len(old), len(new)
    if m == 0 or n == 0:
        return 1

    dp = [[0] * (n + 1) for _ in range(m + 1)]
    ways = [[0] * (n + 1) for _ in range(m + 1)]
    for j in range(n + 1):
        ways[0][j] = 1
    for i in range(m + 1):
        ways[i][0] = 1

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if old[i - 1] == new[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
                ways[i][j] = ways[i - 1][j - 1]
            else:
                if dp[i - 1][j] > dp[i][j - 1]:
                    dp[i][j] = dp[i - 1][j]
                    ways[i][j] = ways[i - 1][j]
                elif dp[i][j - 1] > dp[i - 1][j]:
                    dp[i][j] = dp[i][j - 1]
                    ways[i][j] = ways[i][j - 1]
                else:
                    dp[i][j] = dp[i - 1][j]
                    ways[i][j] = ways[i - 1][j] + ways[i][j - 1]
    return ways[m][n]


def align_fingerprints(
    stored: list[str],
    current: list[str],
    *,
    confidence_threshold: float = 0.8,
) -> AlignmentResult:
    if stored == current:
        return AlignmentResult("identical", [], 1.0)

    n = len(stored)
    if (
        n > 0
        and len(current) >= n
        and stored == current[:n]
        and len(current) > n
    ):
        return AlignmentResult(
            "clean_append",
            [PageRange(n + 1, len(current))],
            1.0,
        )

    if not stored:
        return AlignmentResult(
            "changed",
            [PageRange(1, len(current))] if current else [],
            0.0,
        )

    pairs = _lcs_pairs(stored, current)
    matched_fraction = len(pairs) / n
    has_duplicates = len(set(stored)) < len(stored) or len(set(current)) < len(current)
    alignment_count = _count_max_lcs_alignments(stored, current) if has_duplicates else 1
    if matched_fraction < confidence_threshold or alignment_count > 1:
        return AlignmentResult("ambiguous", [], matched_fraction)

    matched_new = {new_idx for _, new_idx in pairs}
    dirty = [idx + 1 for idx in range(len(current)) if idx not in matched_new]
    suggested = _ranges_from_indices(dirty)
    return AlignmentResult("changed", suggested, matched_fraction)

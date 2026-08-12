from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ChunkPlan:
    chunk_id: str
    index: int
    total: int
    page_start: int
    page_end: int
    image_paths: list[Path]


def plan_chunks(image_paths: list[Path], chunk_size: int) -> list[ChunkPlan]:
    if chunk_size < 1:
        raise ValueError("chunk_size must be >= 1")
    ordered = list(image_paths)
    n = len(ordered)
    total = (n + chunk_size - 1) // chunk_size
    plans: list[ChunkPlan] = []
    for i in range(total):
        start = i * chunk_size
        end = min(start + chunk_size, n)
        plans.append(
            ChunkPlan(
                chunk_id=f"{i + 1:04d}",
                index=i + 1,
                total=total,
                page_start=start + 1,
                page_end=end,
                image_paths=ordered[start:end],
            )
        )
    return plans

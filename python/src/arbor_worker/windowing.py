from __future__ import annotations

from pathlib import Path


def clip_images(image_paths: list[Path], start_page: int) -> list[Path]:
    if start_page < 1:
        raise ValueError("start_page must be >= 1")
    ordered = list(image_paths)
    clipped = ordered[start_page - 1:]
    if not clipped:
        raise ValueError(f"start_page {start_page} is past the last page ({len(ordered)})")
    return clipped

from __future__ import annotations

from pathlib import Path


def clip_window(image_paths: list[Path], start_page: int, end_page: int) -> list[Path]:
    if start_page < 1:
        raise ValueError("start_page must be >= 1")
    if end_page < start_page:
        raise ValueError("end_page must be >= start_page")
    ordered = list(image_paths)
    if end_page > len(ordered):
        raise ValueError(f"end_page {end_page} is past the last page ({len(ordered)})")
    clipped = ordered[start_page - 1 : end_page]
    if not clipped:
        raise ValueError(f"start_page {start_page} is past the last page ({len(ordered)})")
    return clipped


def clip_images(image_paths: list[Path], start_page: int) -> list[Path]:
    if start_page < 1:
        raise ValueError("start_page must be >= 1")
    ordered = list(image_paths)
    if start_page > len(ordered):
        raise ValueError(f"start_page {start_page} is past the last page ({len(ordered)})")
    return clip_window(ordered, start_page, len(ordered))

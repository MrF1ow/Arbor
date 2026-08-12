from pathlib import Path

import pytest

from arbor_worker.windowing import clip_images, clip_images_range


def _imgs(n: int) -> list[Path]:
    return [Path(f"page-{i + 1:05d}.png") for i in range(n)]


def test_clip_from_first_page_returns_all():
    assert clip_images(_imgs(3), 1) == _imgs(3)


def test_clip_drops_leading_pages():
    clipped = clip_images(_imgs(5), 4)
    assert [p.name for p in clipped] == ["page-00004.png", "page-00005.png"]


def test_clip_rejects_zero_or_negative():
    with pytest.raises(ValueError):
        clip_images(_imgs(3), 0)


def test_clip_rejects_window_past_last_page():
    with pytest.raises(ValueError):
        clip_images(_imgs(3), 4)


def test_clip_images_range_returns_inclusive_window():
    clipped = clip_images_range(_imgs(5), 2, 4)
    assert [p.name for p in clipped] == [
        "page-00002.png",
        "page-00003.png",
        "page-00004.png",
    ]

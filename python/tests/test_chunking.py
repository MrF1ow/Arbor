from pathlib import Path

import pytest

from arbor_worker.chunking import ChunkPlan, plan_chunks


def _imgs(n):
    return [Path(f"page-{i + 1:05d}.png") for i in range(n)]


def test_plan_chunks_129_pages():
    plans = plan_chunks(_imgs(129), 25)
    assert len(plans) == 6
    assert plans[0].chunk_id == "0001"
    assert (plans[0].page_start, plans[0].page_end) == (1, 25)
    assert (plans[1].page_start, plans[1].page_end) == (26, 50)
    assert (plans[-1].page_start, plans[-1].page_end) == (126, 129)
    assert plans[-1].total == 6 and plans[-1].index == 6
    assert len(plans[-1].image_paths) == 4
    # ordered and non-overlapping
    assert [p.image_paths[0] for p in plans] == [
        Path("page-00001.png"), Path("page-00026.png"), Path("page-00051.png"),
        Path("page-00076.png"), Path("page-00101.png"), Path("page-00126.png"),
    ]


def test_plan_chunks_exact_multiple():
    plans = plan_chunks(_imgs(50), 25)
    assert len(plans) == 2
    assert (plans[1].page_start, plans[1].page_end) == (26, 50)


def test_plan_chunks_rejects_bad_size():
    with pytest.raises(ValueError):
        plan_chunks(_imgs(10), 0)


def test_plan_chunks_applies_absolute_page_offset():
    plans = plan_chunks(_imgs(4), 2, page_offset=2)
    assert (plans[0].page_start, plans[0].page_end) == (3, 4)
    assert (plans[1].page_start, plans[1].page_end) == (5, 6)
    assert [p.name for p in plans[0].image_paths] == ["page-00001.png", "page-00002.png"]

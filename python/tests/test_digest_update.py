from pathlib import Path

from arbor_worker.alignment import PageRange
from arbor_worker.digest_update import (
    CreateAction,
    PatchAction,
    RegenerateAction,
    classify_digest_actions,
)
from arbor_worker.page_markers import wrap_range_body


def _record(start: int, end: int, digest_file: str = "digests/2026-08-12.md") -> dict:
    return {
        "source_path": "Biology/mega.pdf",
        "start_page": start,
        "end_page": end,
        "digest_file": digest_file,
    }


def test_no_overlap_creates(tmp_path: Path):
    actions = classify_digest_actions(
        tmp_path,
        "Biology/mega.pdf",
        PageRange(20, 30),
        [_record(1, 10)],
    )
    assert len(actions) == 1
    assert isinstance(actions[0], CreateAction)
    assert actions[0].page_range == PageRange(20, 30)


def test_partial_overlap_patches(tmp_path: Path):
    course = tmp_path / "Biology"
    (course / "digests").mkdir(parents=True)
    digest = course / "digests" / "2026-08-12.md"
    digest.write_text(wrap_range_body(PageRange(1, 10), "# Notes\n## Overview\nbody"))

    actions = classify_digest_actions(
        course,
        "Biology/mega.pdf",
        PageRange(4, 5),
        [_record(1, 10)],
    )
    assert len(actions) == 1
    assert isinstance(actions[0], PatchAction)
    assert actions[0].digest_file == "digests/2026-08-12.md"
    assert actions[0].page_range == PageRange(4, 5)


def test_full_coverage_overlap_regenerates(tmp_path: Path):
    course = tmp_path / "Biology"
    (course / "digests").mkdir(parents=True)
    digest = course / "digests" / "2026-08-12.md"
    digest.write_text(wrap_range_body(PageRange(1, 10), "# Notes\n## Overview\nbody"))

    actions = classify_digest_actions(
        course,
        "Biology/mega.pdf",
        PageRange(1, 10),
        [_record(1, 10)],
    )
    assert len(actions) == 1
    assert isinstance(actions[0], RegenerateAction)


def test_missing_markers_regenerates(tmp_path: Path):
    course = tmp_path / "Biology"
    (course / "digests").mkdir(parents=True)
    digest = course / "digests" / "2026-08-12.md"
    digest.write_text("# Notes without markers\n## Overview\nbody long enough here")

    actions = classify_digest_actions(
        course,
        "Biology/mega.pdf",
        PageRange(4, 5),
        [_record(1, 10)],
    )
    assert len(actions) == 1
    assert isinstance(actions[0], RegenerateAction)


def test_multi_digest_overlap(tmp_path: Path):
    course = tmp_path / "Biology"
    (course / "digests").mkdir(parents=True)
    (course / "digests" / "a.md").write_text(
        wrap_range_body(PageRange(1, 5), "# A\n## Overview\nbody")
    )
    (course / "digests" / "b.md").write_text(
        wrap_range_body(PageRange(6, 10), "# B\n## Overview\nbody")
    )

    actions = classify_digest_actions(
        course,
        "Biology/mega.pdf",
        PageRange(4, 7),
        [
            _record(1, 5, "digests/a.md"),
            _record(6, 10, "digests/b.md"),
        ],
    )
    kinds = {type(a) for a in actions}
    assert PatchAction in kinds
    assert len(actions) == 2
    patch_ranges = sorted(
        a.page_range.start for a in actions if isinstance(a, PatchAction)
    )
    assert patch_ranges == [4, 6]

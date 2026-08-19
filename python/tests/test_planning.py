from pathlib import Path

import pytest

from arbor_worker.alignment import PageRange
from arbor_worker.course_manifest import CourseManifest, DigestRecord, SourceFingerprintState
from arbor_worker.errors import PlanError
from arbor_worker.hashing import hash_file
from arbor_worker.page_fingerprints import fingerprint_source
from arbor_worker.planning import apply_selections, build_plan, plan_to_dict
from arbor_worker.settings import WorkerSettings, default_settings


def _fast_settings() -> WorkerSettings:
    settings = default_settings()
    object.__setattr__(settings, "pdf_render_dpi", 72)
    return settings


def _record_for(course_dir: Path, source_path: str, source_hash: str, page_count: int) -> None:
    m = CourseManifest.load(course_dir)
    m.record(
        DigestRecord(
            source_path=source_path,
            source_hash=source_hash,
            page_count=page_count,
            start_page=1,
            end_page=page_count,
            digest_file="digests/2026-08-12.md",
            model_id="m",
            processing_path="pdf_images",
            generate_mode="single",
            chunk_count=None,
            digested_at="2026-08-12T00:00:00+00:00",
        )
    )
    m.save()


def _store_fingerprints(
    course_dir: Path,
    source_path: str,
    abs_path: Path,
    settings: WorkerSettings,
) -> None:
    result = fingerprint_source(abs_path, settings)
    m = CourseManifest.load(course_dir)
    m.set_source(
        source_path,
        SourceFingerprintState(
            source_hash=hash_file(abs_path),
            page_count=len(result.fingerprints),
            fingerprint_kind=result.kind,
            page_fingerprints=result.fingerprints,
            updated_at="2026-08-12T00:00:00+00:00",
        ),
    )
    m.save()


def test_new_source_is_pending(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "mega.pdf", pages=3)

    plan = build_plan(tmp_path, default_settings())
    assert len(plan.pending) == 1
    p = plan.pending[0]
    assert p.path == "Biology/mega.pdf"
    assert p.course == "Biology"
    assert p.page_count == 3
    assert p.suggested_ranges == []
    assert p.alignment_status == "ambiguous"
    assert p.previously_digested is False


def test_unchanged_digested_source_is_not_pending(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    pdf = make_pdf(tmp_path / "Biology" / "mega.pdf", pages=3)
    _record_for(tmp_path / "Biology", "Biology/mega.pdf", hash_file(pdf), 3)

    plan = build_plan(tmp_path, default_settings())
    assert plan.pending == []


def test_grown_source_without_fingerprints_suggests_tail_range(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    pdf = make_pdf(tmp_path / "Biology" / "mega.pdf", pages=2)
    _record_for(tmp_path / "Biology", "Biology/mega.pdf", hash_file(pdf), 2)
    make_pdf(tmp_path / "Biology" / "mega.pdf", pages=5)

    plan = build_plan(tmp_path, default_settings())
    assert len(plan.pending) == 1
    p = plan.pending[0]
    assert p.page_count == 5
    assert p.suggested_ranges == [PageRange(3, 5)]
    assert p.alignment_status == "clean_append"
    assert p.previously_digested is True


def test_grown_source_with_stored_prefix_suggests_clean_append(tmp_path: Path, make_pdf):
    settings = _fast_settings()
    (tmp_path / "Biology").mkdir()
    pdf = make_pdf(tmp_path / "Biology" / "mega.pdf", pages=2)
    _record_for(tmp_path / "Biology", "Biology/mega.pdf", hash_file(pdf), 2)
    _store_fingerprints(tmp_path / "Biology", "Biology/mega.pdf", pdf, settings)
    make_pdf(tmp_path / "Biology" / "mega.pdf", pages=5)

    plan = build_plan(tmp_path, settings)
    assert len(plan.pending) == 1
    p = plan.pending[0]
    assert p.page_count == 5
    assert p.suggested_ranges == [PageRange(3, 5)]
    assert p.alignment_status == "clean_append"
    assert p.previously_digested is True


def test_truncated_changed_empty_ranges_are_not_full_ingest(tmp_path: Path, make_pdf):
    settings = _fast_settings()
    (tmp_path / "Biology").mkdir()
    pdf = make_pdf(tmp_path / "Biology" / "mega.pdf", pages=5)
    _record_for(tmp_path / "Biology", "Biology/mega.pdf", hash_file(pdf), 5)
    _store_fingerprints(tmp_path / "Biology", "Biology/mega.pdf", pdf, settings)
    make_pdf(tmp_path / "Biology" / "mega.pdf", pages=4)

    plan = build_plan(tmp_path, settings)
    assert len(plan.pending) == 1
    p = plan.pending[0]
    assert p.page_count == 4
    assert p.alignment_status == "changed"
    assert p.suggested_ranges == []
    assert p.previously_digested is True

    selected = apply_selections(plan, {"Biology/mega.pdf": None})
    assert selected[0].ranges == []

    selected_empty = apply_selections(plan, {"Biology/mega.pdf": []})
    assert selected_empty[0].ranges == []


def test_plan_to_dict_shape(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "mega.pdf", pages=2)

    data = plan_to_dict(build_plan(tmp_path, default_settings()))
    assert data["pending"][0] == {
        "path": "Biology/mega.pdf",
        "course": "Biology",
        "source_type": "pdf",
        "page_count": 2,
        "suggested_ranges": [],
        "alignment_status": "ambiguous",
        "previously_digested": False,
    }


def test_plan_to_dict_encodes_ranges_as_start_end_pairs(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    pdf = make_pdf(tmp_path / "Biology" / "mega.pdf", pages=2)
    _record_for(tmp_path / "Biology", "Biology/mega.pdf", hash_file(pdf), 2)
    make_pdf(tmp_path / "Biology" / "mega.pdf", pages=5)

    data = plan_to_dict(build_plan(tmp_path, default_settings()))
    assert data["pending"][0]["suggested_ranges"] == [[3, 5]]
    assert data["pending"][0]["alignment_status"] == "clean_append"
    assert "suggested_start_page" not in data["pending"][0]


def test_no_selections_processes_everything_as_full_file(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "a.pdf", pages=2)
    make_pdf(tmp_path / "Biology" / "b.pdf", pages=2)

    plan = build_plan(tmp_path, default_settings())
    selected = apply_selections(plan, {})
    assert [s.path for s in selected] == ["Biology/a.pdf", "Biology/b.pdf"]
    assert all(s.ranges == [PageRange(1, 2)] for s in selected)


def test_selections_filter_and_set_ranges(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "a.pdf", pages=4)
    make_pdf(tmp_path / "Biology" / "b.pdf", pages=4)

    plan = build_plan(tmp_path, default_settings())
    selected = apply_selections(plan, {"Biology/b.pdf": [PageRange(3, 4)]})
    assert [(s.path, s.ranges) for s in selected] == [
        ("Biology/b.pdf", [PageRange(3, 4)])
    ]


def test_null_or_empty_ranges_mean_full_ingest(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "a.pdf", pages=4)

    plan = build_plan(tmp_path, default_settings())
    selected = apply_selections(plan, {"Biology/a.pdf": None})
    assert selected[0].ranges == [PageRange(1, 4)]

    selected_empty = apply_selections(plan, {"Biology/a.pdf": []})
    assert selected_empty[0].ranges == [PageRange(1, 4)]


def test_out_of_range_selection_raises(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "a.pdf", pages=2)

    plan = build_plan(tmp_path, default_settings())
    with pytest.raises(PlanError):
        apply_selections(plan, {"Biology/a.pdf": [PageRange(3, 3)]})


def test_inverted_range_raises(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "a.pdf", pages=4)

    plan = build_plan(tmp_path, default_settings())
    with pytest.raises(PlanError):
        apply_selections(plan, {"Biology/a.pdf": [PageRange(3, 1)]})


def test_unknown_selection_path_raises(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "a.pdf", pages=2)

    plan = build_plan(tmp_path, default_settings())
    with pytest.raises(PlanError):
        apply_selections(plan, {"Biology/missing.pdf": [PageRange(1, 1)]})

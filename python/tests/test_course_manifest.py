from pathlib import Path

from arbor_worker.course_manifest import CourseManifest, DigestRecord


def _record(**over) -> DigestRecord:
    base = dict(
        source_path="Bio/mega.pdf",
        source_hash="hash-1",
        page_count=150,
        start_page=1,
        end_page=150,
        digest_file="digests/2026-08-12.md",
        model_id="m",
        processing_path="pdf_images",
        generate_mode="single",
        chunk_count=None,
        digested_at="2026-08-12T00:00:00+00:00",
    )
    base.update(over)
    return DigestRecord(**base)


def test_missing_manifest_starts_empty(tmp_path: Path):
    m = CourseManifest.load(tmp_path)
    assert m.records() == []
    assert m.latest_for("Bio/mega.pdf") is None
    assert m.is_current("Bio/mega.pdf", "hash-1") is False


def test_record_save_and_reload(tmp_path: Path):
    m = CourseManifest.load(tmp_path)
    m.record(_record())
    m.save()

    again = CourseManifest.load(tmp_path)
    assert again.is_current("Bio/mega.pdf", "hash-1") is True
    assert again.is_current("Bio/mega.pdf", "hash-2") is False
    assert again.latest_for("Bio/mega.pdf")["digest_file"] == "digests/2026-08-12.md"
    assert (tmp_path / CourseManifest.FILENAME).is_file()


def test_latest_for_uses_most_recent_record(tmp_path: Path):
    m = CourseManifest.load(tmp_path)
    m.record(_record())
    m.record(
        _record(
            source_hash="hash-2",
            page_count=300,
            start_page=151,
            end_page=300,
            digest_file="digests/2026-09-01.md",
            digested_at="2026-09-01T00:00:00+00:00",
        )
    )
    latest = m.latest_for("Bio/mega.pdf")
    assert latest["start_page"] == 151
    assert m.is_current("Bio/mega.pdf", "hash-2") is True
    assert m.digest_files() == ["digests/2026-08-12.md", "digests/2026-09-01.md"]


def test_read_digests_returns_label_and_markdown(tmp_path: Path):
    (tmp_path / "digests").mkdir()
    (tmp_path / "digests" / "2026-08-12.md").write_text("# one\n")
    m = CourseManifest.load(tmp_path)
    m.record(_record())
    assert m.read_digests() == [("2026-08-12.md", "# one\n")]


def test_read_digests_skips_missing_files(tmp_path: Path):
    m = CourseManifest.load(tmp_path)
    m.record(_record())
    assert m.read_digests() == []

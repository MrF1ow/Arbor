import io
import json

from arbor_worker.events import EventEmitter, parse_lines


def test_emit_writes_one_json_line_with_type_and_ts():
    buf = io.StringIO()
    em = EventEmitter(buf)
    ev = em.emit("stage", course_dir="Bio", stage="prepare", status="ok")
    lines = buf.getvalue().splitlines()
    assert len(lines) == 1
    obj = json.loads(lines[0])
    assert obj["type"] == "stage"
    assert obj["stage"] == "prepare"
    assert obj["status"] == "ok"
    assert "ts" in obj
    assert obj == ev


def test_convenience_methods():
    buf = io.StringIO()
    em = EventEmitter(buf)
    em.run_started(root="/k", model_id="m", provider="fake")
    em.run_done(processed=1, failed=0, skipped=2)
    events = parse_lines(buf.getvalue())
    assert [e["type"] for e in events] == ["run_started", "run_done"]
    assert events[1]["processed"] == 1
    assert events[1]["skipped"] == 2


def test_chunk_and_synthesis_events():
    import io
    from arbor_worker.events import EventEmitter, parse_lines

    buf = io.StringIO()
    em = EventEmitter(buf)
    em.chunk_started(course_dir="Bio", chunk_id="0001", page_start=1, page_end=25, index=1, total=3)
    em.chunk_done(course_dir="Bio", chunk_id="0001", page_start=1, page_end=25, index=1, total=3)
    em.chunk_failed(course_dir="Bio", chunk_id="0002", page_start=26, page_end=50, code="CHUNK_GENERATE_FAILED", message="x")
    em.synthesis_started(course_dir="Bio", chunk_count=3)
    em.synthesis_done(course_dir="Bio")
    em.synthesis_failed(course_dir="Bio", code="SYNTHESIS_FAILED", message="y")

    types = [e["type"] for e in parse_lines(buf.getvalue())]
    assert types == [
        "chunk_started", "chunk_done", "chunk_failed",
        "synthesis_started", "synthesis_done", "synthesis_failed",
    ]


def test_course_events():
    buf = io.StringIO()
    em = EventEmitter(buf)
    em.course_started(course_dir="Biology", sources=2)
    em.source_started(course_dir="Biology", source="Biology/mega.pdf", ranges=[[151, 160]])
    em.source_done(course_dir="Biology", source="Biology/mega.pdf", digest="digests/2026-08-12.md")
    em.source_failed(course_dir="Biology", source="Biology/bad.pdf", message="boom")
    em.source_deleted(course_dir="Biology", source="Biology/mega.pdf")
    em.course_synthesis_started(course_dir="Biology", digest_count=3)
    em.course_synthesis_done(course_dir="Biology")
    em.course_synthesis_failed(course_dir="Biology", code="COURSE_SYNTHESIS_FAILED", message="x")
    em.course_done(course_dir="Biology", digests=1)

    events = parse_lines(buf.getvalue())
    types = [e["type"] for e in events]
    assert types == [
        "course_started",
        "source_started",
        "source_done",
        "source_failed",
        "source_deleted",
        "course_synthesis_started",
        "course_synthesis_done",
        "course_synthesis_failed",
        "course_done",
    ]
    assert events[1]["ranges"] == [[151, 160]]


def test_lecture_events_removed():
    assert not hasattr(EventEmitter, "lecture_started")
    assert not hasattr(EventEmitter, "lecture_done")
    assert not hasattr(EventEmitter, "lecture_failed")

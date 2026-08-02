import io
import json

from arbor_worker.events import EventEmitter, parse_lines


def test_emit_writes_one_json_line_with_type_and_ts():
    buf = io.StringIO()
    em = EventEmitter(buf)
    ev = em.emit("stage", lecture_dir="Bio/L1", stage="prepare", status="ok")
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

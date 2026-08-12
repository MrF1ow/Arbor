from datetime import datetime, timezone
from pathlib import Path

from arbor_worker.digest_files import next_digest_path

NOW = datetime(2026, 8, 12, 14, 30, tzinfo=timezone.utc)


def test_first_digest_uses_date(tmp_path: Path):
    path = next_digest_path(tmp_path, "digests", NOW)
    assert path == tmp_path / "digests" / "2026-08-12.md"
    assert path.parent.is_dir()


def test_second_same_day_uses_timestamp(tmp_path: Path):
    first = next_digest_path(tmp_path, "digests", NOW)
    first.write_text("one\n")
    second = next_digest_path(tmp_path, "digests", NOW)
    assert second.name == "2026-08-12T1430.md"


def test_third_same_minute_gets_suffix(tmp_path: Path):
    next_digest_path(tmp_path, "digests", NOW).write_text("one\n")
    next_digest_path(tmp_path, "digests", NOW).write_text("two\n")
    third = next_digest_path(tmp_path, "digests", NOW)
    assert third.name == "2026-08-12T1430-2.md"

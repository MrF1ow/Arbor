from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import TextIO


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_lines(text: str) -> list[dict]:
    return [json.loads(line) for line in text.splitlines() if line.strip()]


class EventEmitter:
    def __init__(self, stream: TextIO):
        self._stream = stream

    def emit(self, type: str, **fields) -> dict:
        obj = {"type": type, "ts": _now(), **fields}
        self._stream.write(json.dumps(obj) + "\n")
        self._stream.flush()
        return obj

    def run_started(self, **f):
        return self.emit("run_started", **f)

    def nothing_to_process(self, **f):
        return self.emit("nothing_to_process", **f)

    def course_started(self, **f):
        return self.emit("course_started", **f)

    def course_done(self, **f):
        return self.emit("course_done", **f)

    def source_started(self, **f):
        return self.emit("source_started", **f)

    def source_done(self, **f):
        return self.emit("source_done", **f)

    def source_failed(self, **f):
        return self.emit("source_failed", **f)

    def source_deleted(self, **f):
        return self.emit("source_deleted", **f)

    def skill_started(self, **f):
        return self.emit("skill_started", **f)

    def skill_progress(self, **f):
        return self.emit("skill_progress", **f)

    def skill_done(self, **f):
        return self.emit("skill_done", **f)

    def skill_failed(self, **f):
        return self.emit("skill_failed", **f)

    def skill_stale_skipped(self, **f):
        return self.emit("skill_stale_skipped", **f)

    def course_synthesis_started(self, **f):
        return self.emit("course_synthesis_started", **f)

    def course_synthesis_done(self, **f):
        return self.emit("course_synthesis_done", **f)

    def course_synthesis_failed(self, **f):
        return self.emit("course_synthesis_failed", **f)

    def stage(self, **f):
        return self.emit("stage", **f)

    def warning(self, **f):
        return self.emit("warning", **f)

    def cancelled(self, **f):
        return self.emit("cancelled", **f)

    def committed(self, **f):
        return self.emit("committed", **f)

    def run_done(self, **f):
        return self.emit("run_done", **f)

    def auth_failed(self, **f):
        return self.emit("auth_failed", **f)

    def error(self, **f):
        return self.emit("error", **f)

    def chunk_started(self, **f):
        return self.emit("chunk_started", **f)

    def chunk_done(self, **f):
        return self.emit("chunk_done", **f)

    def chunk_failed(self, **f):
        return self.emit("chunk_failed", **f)

    def synthesis_started(self, **f):
        return self.emit("synthesis_started", **f)

    def synthesis_done(self, **f):
        return self.emit("synthesis_done", **f)

    def synthesis_failed(self, **f):
        return self.emit("synthesis_failed", **f)

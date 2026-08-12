from __future__ import annotations

CHUNK_GENERATE_FAILED = "CHUNK_GENERATE_FAILED"
SYNTHESIS_FAILED = "SYNTHESIS_FAILED"


class ArborError(Exception):
    code = "ERROR"

    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code


class ChunkGenerateError(ArborError):
    code = CHUNK_GENERATE_FAILED


class SynthesisError(ArborError):
    code = SYNTHESIS_FAILED


SOURCE_PROBE_FAILED = "SOURCE_PROBE_FAILED"
COURSE_SYNTHESIS_FAILED = "COURSE_SYNTHESIS_FAILED"
PLAN_INVALID = "PLAN_INVALID"


class ProbeError(ArborError):
    code = SOURCE_PROBE_FAILED


class CourseSynthesisError(ArborError):
    code = COURSE_SYNTHESIS_FAILED


class PlanError(ArborError):
    code = PLAN_INVALID

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

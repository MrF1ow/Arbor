from arbor_worker.errors import (
    CHUNK_GENERATE_FAILED,
    SYNTHESIS_FAILED,
    ArborError,
    ChunkGenerateError,
    SynthesisError,
)


def test_error_codes_and_messages():
    e = ChunkGenerateError("boom")
    assert isinstance(e, ArborError)
    assert e.code == CHUNK_GENERATE_FAILED
    assert e.message == "boom"

    s = SynthesisError("nope")
    assert s.code == SYNTHESIS_FAILED
    assert str(s) == "nope"

    custom = ArborError("x", code="CUSTOM")
    assert custom.code == "CUSTOM"

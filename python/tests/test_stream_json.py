from pathlib import Path

import pytest

from arbor_worker.provider.base import ProviderError
from arbor_worker.provider.stream_json import iter_stream_json

FIXTURES = Path(__file__).resolve().parent / "fixtures"
GROK_STREAM = FIXTURES / "grok_stream_messages.ndjson"


def test_iter_stream_json_grok_fixture():
    deltas: list[str] = []
    lines = GROK_STREAM.read_text().splitlines()
    final = iter_stream_json(lines, deltas.append, label="grok")
    assert final == "one two three four five"
    assert "".join(deltas) == "one two three four five"


def test_iter_stream_json_falls_back_to_deltas_without_result():
    lines = [
        '{"type":"stream_event","event":{"type":"content_block_delta","index":0,'
        '"delta":{"type":"text_delta","text":"hello"}}}',
    ]
    deltas: list[str] = []
    final = iter_stream_json(lines, deltas.append, label="claude")
    assert final == "hello"
    assert deltas == ["hello"]


def test_iter_stream_json_malformed_line():
    with pytest.raises(ProviderError, match="invalid stream JSON"):
        iter_stream_json(["not json"], lambda _t: None, label="claude")


def test_iter_stream_json_result_error():
    lines = ['{"type":"result","is_error":true,"result":"Auth failed"}']
    with pytest.raises(ProviderError, match="Auth failed"):
        iter_stream_json(lines, lambda _t: None, label="grok")


def test_iter_stream_json_tool_use_in_stream():
    lines = [
        '{"type":"stream_event","event":{"type":"content_block_start","index":0,'
        '"content_block":{"type":"tool_use","name":"read_file"}}}',
    ]
    with pytest.raises(ProviderError, match="tool call \\(read_file\\)"):
        iter_stream_json(lines, lambda _t: None, label="claude")


def test_iter_stream_json_empty_result():
    lines = ['{"type":"result","is_error":false,"result":""}']
    with pytest.raises(ProviderError, match="empty result"):
        iter_stream_json(lines, lambda _t: None, label="grok")


def test_iter_stream_json_error_line():
    lines = ['{"type":"error","message":"not logged in"}']
    with pytest.raises(ProviderError, match="not logged in"):
        iter_stream_json(lines, lambda _t: None, label="claude")

import json

import pytest

from arbor_worker.provider.base import ProviderError
from arbor_worker.provider.openai_compat import iter_chat_completions_sse

TEST_KEY = "sk-test-arbor-not-a-real-key"


def _lines(*rows: str):
    return (row.encode("utf-8") for row in rows)


def test_iter_chat_completions_sse_error_after_content():
    payload = json.dumps({"error": {"message": f"bad key {TEST_KEY}"}})
    lines = _lines(
        f'data: {json.dumps({"choices": [{"delta": {"content": "Hello"}}]})}',
        f"data: {payload}",
    )
    deltas: list[str] = []
    with pytest.raises(ProviderError) as exc:
        iter_chat_completions_sse(lines, deltas.append, secret=TEST_KEY)
    assert TEST_KEY not in str(exc.value)
    assert "[redacted]" in str(exc.value)
    assert deltas == ["Hello"]


def test_iter_chat_completions_sse_error_only_includes_excerpt():
    payload = json.dumps({"error": {"message": f"denied {TEST_KEY}"}})
    lines = _lines(f"data: {payload}")
    with pytest.raises(ProviderError) as exc:
        iter_chat_completions_sse(lines, lambda _t: None, secret=TEST_KEY)
    message = str(exc.value)
    assert TEST_KEY not in message
    assert "[redacted]" in message

import errno
import json
from pathlib import Path

import pytest

from arbor_worker.provider.anthropic_api import (
    ANTHROPIC_SESSION_GUARD,
    AnthropicApiProvider,
    _iter_anthropic_sse,
)
from arbor_worker.provider.base import Model, ProviderError, ProviderRequest
from arbor_worker.provider.http_transport import urllib_http_request

TEST_KEY = "sk-test-arbor-not-a-real-key"


class RecordingTransport:
    def __init__(self, responder=None):
        self.calls: list[dict] = []
        self._responder = responder or (lambda *a: (200, b"{}"))

    def __call__(self, method, url, headers, body, timeout):
        self.calls.append(
            {
                "method": method,
                "url": url,
                "headers": headers,
                "body": body,
                "timeout": timeout,
            }
        )
        return self._responder(method, url, headers, body, timeout)


def _message_response(text: str) -> bytes:
    return json.dumps({"content": [{"type": "text", "text": text}]}).encode()


@pytest.fixture
def tmp_path_png(tmp_path: Path) -> Path:
    img = tmp_path / "tiny.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n\x00")
    return img


@pytest.fixture(autouse=True)
def _no_claudecode(monkeypatch):
    monkeypatch.delenv("CLAUDECODE", raising=False)


def test_run_success(tmp_path: Path):
    transport = RecordingTransport(lambda *a: (200, _message_response("anthropic text")))
    prov = AnthropicApiProvider(
        models=[Model("claude-sonnet-5-5", "Sonnet")],
        transport=transport,
        base_url="http://fake-anthropic",
        api_key=TEST_KEY,
    )
    req = ProviderRequest(
        prompt="question",
        model_id="claude-sonnet-5-5",
        cwd=tmp_path,
        system="sys prompt",
    )
    res = prov.run(req)
    assert res.markdown == "anthropic text"
    assert transport.calls[0]["url"] == "http://fake-anthropic/v1/messages"
    body = json.loads(transport.calls[0]["body"])
    assert body["system"] == "sys prompt"
    assert body["messages"] == [{"role": "user", "content": "question"}]
    assert all(m.get("role") != "system" for m in body["messages"])


def test_claudecode_guard(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("CLAUDECODE", "1")
    transport = RecordingTransport(lambda *a: (200, _message_response("nope")))
    prov = AnthropicApiProvider(
        models=[],
        transport=transport,
        base_url="http://fake-anthropic",
        api_key=TEST_KEY,
    )
    st = prov.status()
    assert st.reason == ANTHROPIC_SESSION_GUARD
    with pytest.raises(ProviderError, match=ANTHROPIC_SESSION_GUARD):
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))
    assert transport.calls == []


def test_missing_key(tmp_path: Path):
    transport = RecordingTransport()
    prov = AnthropicApiProvider(
        models=[],
        transport=transport,
        base_url="http://fake-anthropic",
        api_key="",
    )
    assert prov.status().reason == "key missing"
    with pytest.raises(ProviderError, match="key missing"):
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))
    assert transport.calls == []


def test_status_with_key_no_http():
    transport = RecordingTransport()
    prov = AnthropicApiProvider(
        models=[],
        transport=transport,
        base_url="http://fake-anthropic",
        api_key=TEST_KEY,
    )
    assert prov.status().available is True
    assert transport.calls == []


def test_401_no_key_leak(tmp_path: Path):
    body = json.dumps({"error": TEST_KEY}).encode()
    transport = RecordingTransport(lambda *a: (401, body))
    prov = AnthropicApiProvider(
        models=[],
        transport=transport,
        base_url="http://fake-anthropic",
        api_key=TEST_KEY,
    )
    with pytest.raises(ProviderError) as exc:
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))
    assert TEST_KEY not in str(exc.value)


def test_connection_refused(tmp_path: Path):
    def refuse(*a):
        raise ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused")

    prov = AnthropicApiProvider(
        models=[],
        transport=RecordingTransport(refuse),
        base_url="http://fake-anthropic",
        api_key=TEST_KEY,
    )
    with pytest.raises(
        ProviderError, match="Could not reach Anthropic API at http://fake-anthropic"
    ):
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))


def test_malformed_json(tmp_path: Path):
    transport = RecordingTransport(lambda *a: (200, b"not json"))
    prov = AnthropicApiProvider(
        models=[],
        transport=transport,
        base_url="http://fake-anthropic",
        api_key=TEST_KEY,
    )
    with pytest.raises(ProviderError, match="malformed JSON"):
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))


def test_images_base64_block(tmp_path_png: Path):
    transport = RecordingTransport(lambda *a: (200, _message_response("seen")))
    prov = AnthropicApiProvider(
        models=[],
        transport=transport,
        base_url="http://fake-anthropic",
        api_key=TEST_KEY,
    )
    prov.run(
        ProviderRequest(
            prompt="look",
            model_id="m",
            image_paths=[tmp_path_png],
            cwd=tmp_path_png.parent,
        )
    )
    body = json.loads(transport.calls[0]["body"])
    content = body["messages"][0]["content"]
    assert content[1]["type"] == "image"
    assert content[1]["source"]["type"] == "base64"


def test_run_propagates_host_block_provider_error(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("ARBOR_ALLOW_REMOTE_API", raising=False)
    prov = AnthropicApiProvider(
        models=[],
        transport=urllib_http_request,
        api_key=TEST_KEY,
    )
    with pytest.raises(ProviderError, match="blocked") as exc:
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))
    assert TEST_KEY not in str(exc.value)
    assert "Could not reach" not in str(exc.value)


def test_no_system_omitted(tmp_path: Path):
    transport = RecordingTransport(lambda *a: (200, _message_response("ok")))
    prov = AnthropicApiProvider(
        models=[],
        transport=transport,
        base_url="http://fake-anthropic",
        api_key=TEST_KEY,
    )
    prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path, system=None))
    body = json.loads(transport.calls[0]["body"])
    assert "system" not in body


def test_iter_anthropic_sse_error_redacts_api_key():
    lines = iter(
        [
            b"event: error\n",
            f'data: {{"type":"error","error":{{"message":"bad {TEST_KEY}"}}}}\n'.encode(),
        ]
    )
    with pytest.raises(ProviderError) as exc:
        _iter_anthropic_sse(lines, lambda _t: None, api_key=TEST_KEY)
    assert TEST_KEY not in str(exc.value)
    assert "[redacted]" in str(exc.value)

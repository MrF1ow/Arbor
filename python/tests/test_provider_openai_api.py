import errno
import json
from pathlib import Path

import pytest

from arbor_worker.provider.base import Model, ProviderError, ProviderRequest
from arbor_worker.provider.http_transport import urllib_http_request
from arbor_worker.provider.openai_api import OpenAiApiProvider

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


def _chat_response(text: str) -> bytes:
    return json.dumps({"choices": [{"message": {"content": text}}]}).encode()


@pytest.fixture
def tmp_path_png(tmp_path: Path) -> Path:
    img = tmp_path / "tiny.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n\x00")
    return img


def test_run_success(tmp_path: Path):
    transport = RecordingTransport(lambda *a: (200, _chat_response("openai says hi")))
    prov = OpenAiApiProvider(
        models=[Model("gpt-5.6-sol", "Sol")],
        transport=transport,
        base_url="http://fake-openai/v1",
        api_key=TEST_KEY,
    )
    req = ProviderRequest(
        prompt="ask",
        model_id="gpt-5.6-sol",
        cwd=tmp_path,
        system="be helpful",
    )
    res = prov.run(req)
    assert res.markdown == "openai says hi"
    assert transport.calls[0]["url"] == "http://fake-openai/v1/chat/completions"
    body = json.loads(transport.calls[0]["body"])
    assert body["model"] == "gpt-5.6-sol"
    assert body["messages"][0]["content"] == "be helpful"


def test_missing_key_status_and_run(tmp_path: Path):
    transport = RecordingTransport()
    prov = OpenAiApiProvider(
        models=[],
        transport=transport,
        base_url="http://fake-openai/v1",
        api_key="",
    )
    st = prov.status()
    assert st.available is False
    assert st.reason == "key missing"
    assert len(transport.calls) == 0
    with pytest.raises(ProviderError, match="key missing"):
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))
    assert len(transport.calls) == 0


def test_status_with_key_no_transport():
    transport = RecordingTransport()
    prov = OpenAiApiProvider(
        models=[],
        transport=transport,
        base_url="http://fake-openai/v1",
        api_key=TEST_KEY,
    )
    st = prov.status()
    assert st.available is True
    assert transport.calls == []


def test_401_does_not_leak_key(tmp_path: Path):
    body = json.dumps({"message": f"bad key {TEST_KEY}"}).encode()
    transport = RecordingTransport(lambda *a: (401, body))
    prov = OpenAiApiProvider(
        models=[],
        transport=transport,
        base_url="http://fake-openai/v1",
        api_key=TEST_KEY,
    )
    with pytest.raises(ProviderError) as exc:
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))
    assert TEST_KEY not in str(exc.value)
    assert "HTTP 401" in str(exc.value)


def test_connection_refused(tmp_path: Path):
    def refuse(*a):
        raise ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused")

    prov = OpenAiApiProvider(
        models=[],
        transport=RecordingTransport(refuse),
        base_url="http://fake-openai/v1",
        api_key=TEST_KEY,
    )
    with pytest.raises(
        ProviderError, match="Could not reach OpenAI API at http://fake-openai/v1"
    ):
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))


def test_malformed_json(tmp_path: Path):
    transport = RecordingTransport(lambda *a: (200, b"[]"))
    prov = OpenAiApiProvider(
        models=[],
        transport=transport,
        base_url="http://fake-openai/v1",
        api_key=TEST_KEY,
    )
    with pytest.raises(ProviderError, match="malformed JSON"):
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))


def test_images_data_url(tmp_path_png: Path):
    transport = RecordingTransport(lambda *a: (200, _chat_response("ok")))
    prov = OpenAiApiProvider(
        models=[],
        transport=transport,
        base_url="http://fake-openai/v1",
        api_key=TEST_KEY,
    )
    prov.run(
        ProviderRequest(
            prompt="img",
            model_id="m",
            image_paths=[tmp_path_png],
            cwd=tmp_path_png.parent,
        )
    )
    body = json.loads(transport.calls[0]["body"])
    parts = body["messages"][-1]["content"]
    assert parts[1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_run_propagates_host_block_provider_error(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("ARBOR_ALLOW_REMOTE_API", raising=False)
    prov = OpenAiApiProvider(
        models=[],
        transport=urllib_http_request,
        api_key=TEST_KEY,
    )
    with pytest.raises(ProviderError, match="blocked") as exc:
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))
    assert TEST_KEY not in str(exc.value)
    assert "Could not reach" not in str(exc.value)


def test_no_images_plain_user_content(tmp_path: Path):
    transport = RecordingTransport(lambda *a: (200, _chat_response("ok")))
    prov = OpenAiApiProvider(
        models=[],
        transport=transport,
        base_url="http://fake-openai/v1",
        api_key=TEST_KEY,
    )
    prov.run(ProviderRequest(prompt="only text", model_id="m", cwd=tmp_path))
    body = json.loads(transport.calls[0]["body"])
    assert body["messages"][-1]["content"] == "only text"

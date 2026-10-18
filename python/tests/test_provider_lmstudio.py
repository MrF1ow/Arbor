import errno
import json
from pathlib import Path

import pytest

from arbor_worker.provider.base import Model, ProviderError, ProviderRequest
from arbor_worker.provider.lmstudio import LmStudioProvider

TEST_KEY = "sk-test-arbor-not-a-real-key"


class RecordingTransport:
    def __init__(self, responder):
        self.calls: list[dict] = []
        self._responder = responder

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
    return json.dumps(
        {"choices": [{"message": {"content": text}}]}
    ).encode()


@pytest.fixture
def tmp_path_png(tmp_path: Path) -> Path:
    img = tmp_path / "tiny.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n\x00")
    return img


def test_run_success(tmp_path: Path):
    transport = RecordingTransport(lambda *a: (200, _chat_response("lm reply")))
    prov = LmStudioProvider(
        models=[],
        transport=transport,
        base_url="http://127.0.0.1:1234/v1",
    )
    req = ProviderRequest(
        prompt="user",
        model_id="local-model",
        cwd=tmp_path,
        system="system here",
    )
    res = prov.run(req)
    assert res.markdown == "lm reply"
    assert transport.calls[0]["url"] == "http://127.0.0.1:1234/v1/chat/completions"
    body = json.loads(transport.calls[0]["body"])
    assert body["model"] == "local-model"
    assert body["messages"][0] == {"role": "system", "content": "system here"}


def test_run_images_use_data_url(tmp_path_png: Path):
    transport = RecordingTransport(lambda *a: (200, _chat_response("ok")))
    prov = LmStudioProvider(models=[], transport=transport, base_url="http://127.0.0.1:1234/v1")
    prov.run(
        ProviderRequest(
            prompt="see",
            model_id="m",
            image_paths=[tmp_path_png],
            cwd=tmp_path_png.parent,
        )
    )
    body = json.loads(transport.calls[0]["body"])
    content = body["messages"][-1]["content"]
    assert isinstance(content, list)
    assert content[1]["type"] == "image_url"
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_run_no_images_string_content(tmp_path: Path):
    transport = RecordingTransport(lambda *a: (200, _chat_response("ok")))
    prov = LmStudioProvider(models=[], transport=transport, base_url="http://127.0.0.1:1234/v1")
    prov.run(ProviderRequest(prompt="plain", model_id="m", cwd=tmp_path))
    body = json.loads(transport.calls[0]["body"])
    assert body["messages"][-1]["content"] == "plain"


def test_auth_401_redacts_key(tmp_path: Path):
    body = json.dumps({"error": f"invalid key {TEST_KEY}"}).encode()
    transport = RecordingTransport(lambda *a: (401, body))
    prov = LmStudioProvider(
        models=[],
        transport=transport,
        base_url="http://127.0.0.1:1234/v1",
        api_key=TEST_KEY,
    )
    with pytest.raises(ProviderError) as exc:
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))
    assert TEST_KEY not in str(exc.value)
    assert "HTTP 401" in str(exc.value)


def test_connection_refused(tmp_path: Path):
    def refuse(*a):
        raise ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused")

    prov = LmStudioProvider(
        models=[],
        transport=RecordingTransport(refuse),
        base_url="http://127.0.0.1:1234/v1",
    )
    with pytest.raises(ProviderError, match="LM Studio is not running at http://127.0.0.1:1234/v1"):
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))


def test_malformed_json(tmp_path: Path):
    transport = RecordingTransport(lambda *a: (200, b"{bad"))
    prov = LmStudioProvider(models=[], transport=transport, base_url="http://127.0.0.1:1234/v1")
    with pytest.raises(ProviderError, match="malformed JSON"):
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))


def test_status_and_list_models_send_bearer_when_key_set():
    transport = RecordingTransport(lambda *a: (200, b'{"data":[]}'))
    prov = LmStudioProvider(
        models=[],
        transport=transport,
        base_url="http://127.0.0.1:1234/v1",
        api_key=TEST_KEY,
    )
    prov.status()
    assert transport.calls[0]["headers"]["Authorization"] == f"Bearer {TEST_KEY}"
    prov.list_models()
    assert transport.calls[1]["headers"]["Authorization"] == f"Bearer {TEST_KEY}"


def test_status_and_list_models_no_auth_without_key():
    transport = RecordingTransport(lambda *a: (200, b'{"data":[]}'))
    prov = LmStudioProvider(
        models=[],
        transport=transport,
        base_url="http://127.0.0.1:1234/v1",
        api_key="",
    )
    prov.status()
    assert "Authorization" not in transport.calls[0]["headers"]
    prov.list_models()
    assert "Authorization" not in transport.calls[1]["headers"]


def test_list_models_success():
    body = json.dumps({"data": [{"id": "local-a"}]}).encode()
    transport = RecordingTransport(lambda *a: (200, body))
    prov = LmStudioProvider(
        models=[Model("fallback", "Fallback")],
        transport=transport,
        base_url="http://127.0.0.1:1234/v1",
    )
    models = prov.list_models()
    assert [m.id for m in models] == ["local-a"]


def test_list_models_http_500_returns_fallback():
    fallback = [Model("fallback", "Fallback")]
    transport = RecordingTransport(lambda *a: (500, b"error"))
    prov = LmStudioProvider(
        models=fallback,
        transport=transport,
        base_url="http://127.0.0.1:1234/v1",
    )
    assert prov.list_models() == fallback

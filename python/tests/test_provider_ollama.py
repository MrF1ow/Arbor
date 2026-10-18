import errno
import json
from pathlib import Path

import pytest

from arbor_worker.provider.base import Model, ProviderError, ProviderRequest
from arbor_worker.provider.ollama import OllamaProvider

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


def _success_response(text: str) -> bytes:
    return json.dumps({"message": {"content": text}}).encode()


@pytest.fixture
def tmp_path_png(tmp_path: Path) -> Path:
    img = tmp_path / "tiny.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n\x00")
    return img


def test_run_success(tmp_path: Path):
    transport = RecordingTransport(
        lambda *a: (200, _success_response("hello from ollama"))
    )
    prov = OllamaProvider(
        models=[Model("fallback", "Fallback")],
        transport=transport,
        base_url="http://127.0.0.1:11434",
    )
    req = ProviderRequest(
        prompt="user prompt",
        model_id="llama3",
        cwd=tmp_path,
        system="sys",
    )
    res = prov.run(req)
    assert res.markdown == "hello from ollama"
    assert transport.calls[0]["url"] == "http://127.0.0.1:11434/api/chat"
    body = json.loads(transport.calls[0]["body"])
    assert body["model"] == "llama3"
    assert body["messages"][0] == {"role": "system", "content": "sys"}
    assert body["messages"][1]["role"] == "user"


def test_run_no_system_omits_system_message(tmp_path: Path):
    transport = RecordingTransport(
        lambda *a: (200, _success_response("ok"))
    )
    prov = OllamaProvider(models=[], transport=transport, base_url="http://127.0.0.1:11434")
    prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path, system=None))
    body = json.loads(transport.calls[0]["body"])
    assert all(m.get("role") != "system" for m in body["messages"])


def test_run_images(tmp_path_png: Path):
    transport = RecordingTransport(
        lambda *a: (200, _success_response("seen"))
    )
    prov = OllamaProvider(models=[], transport=transport, base_url="http://127.0.0.1:11434")
    req = ProviderRequest(
        prompt="describe",
        model_id="m",
        image_paths=[tmp_path_png],
        cwd=tmp_path_png.parent,
    )
    prov.run(req)
    body = json.loads(transport.calls[0]["body"])
    images = body["messages"][-1].get("images")
    assert images and not images[0].startswith("data:")


def test_run_no_images_omits_images_field(tmp_path: Path):
    transport = RecordingTransport(
        lambda *a: (200, _success_response("ok"))
    )
    prov = OllamaProvider(models=[], transport=transport, base_url="http://127.0.0.1:11434")
    prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))
    body = json.loads(transport.calls[0]["body"])
    assert "images" not in body["messages"][-1]


def test_http_401(tmp_path: Path):
    body = json.dumps({"error": TEST_KEY}).encode()
    transport = RecordingTransport(lambda *a: (401, body))
    prov = OllamaProvider(models=[], transport=transport, base_url="http://127.0.0.1:11434")
    with pytest.raises(ProviderError, match="HTTP 401"):
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))


def test_connection_refused(tmp_path: Path):
    def refuse(*a):
        raise ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused")

    transport = RecordingTransport(refuse)
    prov = OllamaProvider(models=[], transport=transport, base_url="http://127.0.0.1:11434")
    with pytest.raises(ProviderError, match="Ollama is not running at http://127.0.0.1:11434"):
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))


def test_malformed_json(tmp_path: Path):
    transport = RecordingTransport(lambda *a: (200, b"not-json"))
    prov = OllamaProvider(models=[], transport=transport, base_url="http://127.0.0.1:11434")
    with pytest.raises(ProviderError, match="malformed JSON"):
        prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))


def test_status_connection_refused():
    def refuse(*a):
        raise ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused")

    prov = OllamaProvider(models=[], transport=RecordingTransport(refuse), base_url="http://127.0.0.1:11434")
    st = prov.status()
    assert st.available is False
    assert st.reason == "Ollama is not running at http://127.0.0.1:11434"


def test_list_models_success():
    body = json.dumps(
        {
            "models": [
                {"name": "llama3:latest"},
                {"model": "only-model"},
            ]
        }
    ).encode()
    transport = RecordingTransport(lambda *a: (200, body))
    fallback = [Model("fallback", "Fallback")]
    prov = OllamaProvider(
        models=fallback,
        transport=transport,
        base_url="http://127.0.0.1:11434",
    )
    models = prov.list_models()
    ids = [m.id for m in models]
    assert ids == ["llama3:latest", "only-model"]
    assert transport.calls[0]["url"] == "http://127.0.0.1:11434/api/tags"


def test_list_models_transport_error_returns_fallback():
    def boom(*a):
        raise OSError("network down")

    fallback = [Model("fallback", "Fallback")]
    prov = OllamaProvider(
        models=fallback,
        transport=RecordingTransport(boom),
        base_url="http://127.0.0.1:11434",
    )
    assert prov.list_models() == fallback

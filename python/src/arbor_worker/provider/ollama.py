from __future__ import annotations

import base64
import json
import os
from collections.abc import Iterator

from arbor_worker.provider.base import (
    DeltaFn,
    Model,
    ProviderError,
    ProviderRequest,
    ProviderResult,
    ProviderStatus,
)
from arbor_worker.provider.http_transport import (
    error_excerpt,
    is_connection_refused,
    parse_json_body,
    strip_trailing_slash,
    urllib_http_request,
    urllib_http_stream,
)

OLLAMA_DOCS_URL = "https://github.com/ollama/ollama/blob/main/docs/api.md"
ENV_OLLAMA_BASE_URL = "ARBOR_OLLAMA_BASE_URL"
DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434"

_STATUS_TIMEOUT = 3.0
_RUN_TIMEOUT = 120.0


class OllamaProvider:
    name = "ollama"

    def __init__(
        self,
        models: list[Model],
        *,
        transport=None,
        stream_transport=None,
        base_url: str | None = None,
        api_key: str | None = None,
    ):
        self._models = models
        self._transport = transport if transport is not None else urllib_http_request
        self._stream_transport = (
            stream_transport if stream_transport is not None else urllib_http_stream
        )
        self._base = strip_trailing_slash(
            base_url or os.environ.get(ENV_OLLAMA_BASE_URL) or DEFAULT_OLLAMA_BASE
        )

    def status(self) -> ProviderStatus:
        url = f"{self._base}/api/tags"
        try:
            status, _body = self._transport("GET", url, {}, None, _STATUS_TIMEOUT)
        except ConnectionRefusedError:
            return ProviderStatus(False, f"Ollama is not running at {self._base}")
        except OSError as exc:
            if is_connection_refused(exc):
                return ProviderStatus(False, f"Ollama is not running at {self._base}")
            return ProviderStatus(False, str(exc) or "Ollama status check failed")
        except Exception as exc:
            if is_connection_refused(exc):
                return ProviderStatus(False, f"Ollama is not running at {self._base}")
            return ProviderStatus(False, str(exc) or "Ollama status check failed")
        if 200 <= status < 300:
            return ProviderStatus(True, "")
        return ProviderStatus(False, f"Ollama returned HTTP {status}")

    def is_available(self) -> bool:
        return self.status().available

    def list_models(self) -> list[Model]:
        url = f"{self._base}/api/tags"
        try:
            status, body = self._transport("GET", url, {}, None, _STATUS_TIMEOUT)
        except Exception:
            return list(self._models)
        if status < 200 or status >= 300:
            return list(self._models)
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            return list(self._models)
        models_raw = payload.get("models")
        if not isinstance(models_raw, list):
            return list(self._models)
        out: list[Model] = []
        for item in models_raw:
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            if not isinstance(name, str) or not name:
                name = item.get("model")
            if isinstance(name, str) and name:
                out.append(Model(id=name, label=name))
        return out if out else list(self._models)

    def _build_chat_body(self, request: ProviderRequest, *, stream: bool = False) -> dict:
        messages: list[dict] = []
        if request.system is not None:
            messages.append({"role": "system", "content": request.system})
        user_msg: dict = {"role": "user", "content": request.prompt}
        if request.image_paths:
            images: list[str] = []
            for path in request.image_paths:
                if not path.is_file():
                    raise ProviderError(f"image not found: {path}")
                images.append(base64.standard_b64encode(path.read_bytes()).decode("ascii"))
            user_msg["images"] = images
        messages.append(user_msg)
        return {"model": request.model_id, "messages": messages, "stream": stream}

    def stream(self, request: ProviderRequest, on_delta: DeltaFn) -> ProviderResult:
        url = f"{self._base}/api/chat"
        body_bytes = json.dumps(self._build_chat_body(request, stream=True)).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        try:
            status, line_iter = self._stream_transport(
                "POST", url, headers, body_bytes, _RUN_TIMEOUT
            )
        except ConnectionRefusedError:
            raise ProviderError(f"Ollama is not running at {self._base}")
        except TimeoutError:
            raise ProviderError("Ollama request timed out")
        except OSError as exc:
            if is_connection_refused(exc):
                raise ProviderError(f"Ollama is not running at {self._base}")
            raise ProviderError(str(exc) or "Ollama request failed")
        except Exception as exc:
            if is_connection_refused(exc):
                raise ProviderError(f"Ollama is not running at {self._base}")
            raise
        if status >= 400:
            err_body = b"".join(line_iter)
            raise ProviderError(error_excerpt(status, err_body, None))
        text = _iter_ollama_ndjson(line_iter, on_delta)
        return ProviderResult(markdown=text)

    def run(self, request: ProviderRequest) -> ProviderResult:
        url = f"{self._base}/api/chat"
        body_bytes = json.dumps(self._build_chat_body(request)).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        try:
            status, resp_body = self._transport(
                "POST", url, headers, body_bytes, _RUN_TIMEOUT
            )
        except ConnectionRefusedError:
            raise ProviderError(f"Ollama is not running at {self._base}")
        except TimeoutError:
            raise ProviderError("Ollama request timed out")
        except OSError as exc:
            if is_connection_refused(exc):
                raise ProviderError(f"Ollama is not running at {self._base}")
            raise ProviderError(str(exc) or "Ollama request failed")
        except Exception as exc:
            if is_connection_refused(exc):
                raise ProviderError(f"Ollama is not running at {self._base}")
            raise
        if status >= 400:
            raise ProviderError(error_excerpt(status, resp_body, None))
        payload = parse_json_body(resp_body, "Ollama returned malformed JSON")
        message = payload.get("message")
        if not isinstance(message, dict):
            raise ProviderError("Ollama response did not include assistant text")
        content = message.get("content")
        if not isinstance(content, str):
            raise ProviderError("Ollama response did not include assistant text")
        return ProviderResult(markdown=content)


def _iter_ollama_ndjson(lines: Iterator[bytes], on_delta: DeltaFn) -> str:
    parts: list[str] = []
    for raw in lines:
        line = raw.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ProviderError("Ollama stream returned malformed JSON") from exc
        if not isinstance(payload, dict):
            continue
        err = payload.get("error")
        if err:
            raise ProviderError(str(err))
        message = payload.get("message")
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str) and content:
                on_delta(content)
                parts.append(content)
        if payload.get("done"):
            break
    joined = "".join(parts)
    if not joined.strip():
        raise ProviderError("Ollama response did not include assistant text")
    return joined

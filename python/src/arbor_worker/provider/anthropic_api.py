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
    image_media_type,
)
from arbor_worker.provider.http_transport import (
    error_excerpt,
    is_connection_refused,
    parse_json_body,
    strip_trailing_slash,
    urllib_http_request,
    urllib_http_stream,
)

ANTHROPIC_API_DOCS_URL = "https://docs.anthropic.com/en/api/messages"
ENV_ANTHROPIC_BASE_URL = "ARBOR_ANTHROPIC_BASE_URL"
ENV_ANTHROPIC_API_KEY = "ARBOR_ANTHROPIC_API_KEY"
DEFAULT_ANTHROPIC_BASE = "https://api.anthropic.com"

ANTHROPIC_SESSION_GUARD = "Anthropic provider disabled inside a Claude Code session"

DEFAULT_ANTHROPIC_API_MODELS = [
    Model(id="claude-sonnet-5-5", label="Sonnet 5.5"),
    Model(id="claude-opus-5-5", label="Opus 5.5"),
    Model(id="claude-haiku-5-5", label="Haiku 5.5"),
]

_RUN_TIMEOUT = 120.0


class AnthropicApiProvider:
    name = "anthropic_api"

    def __init__(
        self,
        models: list[Model],
        *,
        transport=None,
        stream_transport=None,
        base_url: str | None = None,
        api_key: str | None = None,
    ):
        self._models = models if models else list(DEFAULT_ANTHROPIC_API_MODELS)
        self._transport = transport if transport is not None else urllib_http_request
        self._stream_transport = (
            stream_transport if stream_transport is not None else urllib_http_stream
        )
        self._base = strip_trailing_slash(
            base_url or os.environ.get(ENV_ANTHROPIC_BASE_URL) or DEFAULT_ANTHROPIC_BASE
        )
        if api_key is not None:
            self._api_key = api_key
        else:
            self._api_key = os.environ.get(ENV_ANTHROPIC_API_KEY)

    def _guard_active(self) -> bool:
        return os.environ.get("CLAUDECODE") == "1"

    def _resolved_key(self) -> str | None:
        if self._api_key is None:
            return None
        if self._api_key == "":
            return None
        return self._api_key

    def status(self) -> ProviderStatus:
        if self._guard_active():
            return ProviderStatus(False, ANTHROPIC_SESSION_GUARD)
        key = self._resolved_key()
        if not key:
            return ProviderStatus(False, "key missing")
        return ProviderStatus(True, "")

    def is_available(self) -> bool:
        return self.status().available

    def list_models(self) -> list[Model]:
        return list(self._models)

    def _build_body(self, request: ProviderRequest, *, stream: bool = False) -> dict:
        if request.image_paths:
            content: list[dict] = [{"type": "text", "text": request.prompt}]
            for path in request.image_paths:
                if not path.is_file():
                    raise ProviderError(f"image not found: {path}")
                data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
                content.append(
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": image_media_type(path),
                            "data": data,
                        },
                    }
                )
            user_content: str | list = content
        else:
            user_content = request.prompt
        body: dict = {
            "model": request.model_id,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": user_content}],
        }
        if request.system is not None:
            body["system"] = request.system
        if stream:
            body["stream"] = True
        return body

    def _stream_http(self, request: ProviderRequest, on_delta: DeltaFn) -> ProviderResult:
        if self._guard_active():
            raise ProviderError(ANTHROPIC_SESSION_GUARD)
        key = self._resolved_key()
        if not key:
            raise ProviderError("key missing")
        url = f"{self._base}/v1/messages"
        body_bytes = json.dumps(self._build_body(request, stream=True)).encode("utf-8")
        headers = {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        try:
            status, line_iter = self._stream_transport(
                "POST", url, headers, body_bytes, _RUN_TIMEOUT
            )
        except ProviderError:
            raise
        except ConnectionRefusedError:
            raise ProviderError(f"Could not reach Anthropic API at {self._base}")
        except TimeoutError:
            raise ProviderError("Anthropic API request timed out")
        except OSError as exc:
            if is_connection_refused(exc):
                raise ProviderError(f"Could not reach Anthropic API at {self._base}")
            raise
        if status in (401, 403):
            raise ProviderError(f"Anthropic API key was rejected (HTTP {status})")
        if status >= 400:
            err_body = b"".join(line_iter)
            raise ProviderError(error_excerpt(status, err_body, key))
        text = _iter_anthropic_sse(line_iter, on_delta)
        return ProviderResult(markdown=text)

    def stream(self, request: ProviderRequest, on_delta: DeltaFn) -> ProviderResult:
        return self._stream_http(request, on_delta)

    def run(self, request: ProviderRequest) -> ProviderResult:
        if self._guard_active():
            raise ProviderError(ANTHROPIC_SESSION_GUARD)
        key = self._resolved_key()
        if not key:
            raise ProviderError("key missing")
        url = f"{self._base}/v1/messages"
        body_bytes = json.dumps(self._build_body(request)).encode("utf-8")
        headers = {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        try:
            status, resp_body = self._transport(
                "POST", url, headers, body_bytes, _RUN_TIMEOUT
            )
        except ProviderError:
            raise
        except ConnectionRefusedError:
            raise ProviderError(f"Could not reach Anthropic API at {self._base}")
        except TimeoutError:
            raise ProviderError("Anthropic API request timed out")
        except OSError as exc:
            if is_connection_refused(exc):
                raise ProviderError(f"Could not reach Anthropic API at {self._base}")
            raise
        if status in (401, 403):
            raise ProviderError(f"Anthropic API key was rejected (HTTP {status})")
        if status >= 400:
            raise ProviderError(error_excerpt(status, resp_body, key))
        payload = parse_json_body(resp_body, "Anthropic API returned malformed JSON")
        blocks = payload.get("content")
        if not isinstance(blocks, list):
            raise ProviderError("Anthropic API response did not include assistant text")
        parts: list[str] = []
        for block in blocks:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        joined = "".join(parts)
        if not joined:
            raise ProviderError("Anthropic API response did not include assistant text")
        return ProviderResult(markdown=joined)


def _iter_anthropic_sse(lines: Iterator[bytes], on_delta: DeltaFn) -> str:
    event_type: str | None = None
    parts: list[str] = []
    for raw in lines:
        line = raw.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        if line.startswith("event: "):
            event_type = line[7:].strip()
            continue
        if not line.startswith("data: "):
            continue
        try:
            data = json.loads(line[6:])
        except json.JSONDecodeError as exc:
            raise ProviderError("Anthropic API stream returned invalid JSON") from exc
        if event_type == "error":
            message = "Anthropic API stream error"
            if isinstance(data, dict):
                err = data.get("error")
                if isinstance(err, dict) and isinstance(err.get("message"), str):
                    message = err["message"]
                elif isinstance(data.get("message"), str):
                    message = data["message"]
            raise ProviderError(message)
        if event_type != "content_block_delta" or not isinstance(data, dict):
            continue
        delta = data.get("delta")
        if not isinstance(delta, dict) or delta.get("type") != "text_delta":
            continue
        text = delta.get("text")
        if isinstance(text, str) and text:
            on_delta(text)
            parts.append(text)
    joined = "".join(parts)
    if not joined.strip():
        raise ProviderError("Anthropic API response did not include assistant text")
    return joined

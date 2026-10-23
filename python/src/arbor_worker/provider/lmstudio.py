from __future__ import annotations

import os

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
    redact_secret,
    strip_trailing_slash,
    urllib_http_request,
    urllib_http_stream,
)
from arbor_worker.provider.openai_compat import (
    chat_completions_json_body,
    iter_chat_completions_sse,
    parse_chat_completions_content,
)

LMSTUDIO_DOCS_URL = "https://lmstudio.ai/docs/app/api"
ENV_LMSTUDIO_BASE_URL = "ARBOR_LMSTUDIO_BASE_URL"
ENV_LMSTUDIO_API_KEY = "ARBOR_LMSTUDIO_API_KEY"
DEFAULT_LMSTUDIO_BASE = "http://127.0.0.1:1234/v1"

_STATUS_TIMEOUT = 3.0
_RUN_TIMEOUT = 120.0


class LmStudioProvider:
    name = "lmstudio"

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
            base_url or os.environ.get(ENV_LMSTUDIO_BASE_URL) or DEFAULT_LMSTUDIO_BASE
        )
        if api_key is not None:
            self._api_key = api_key
        else:
            self._api_key = os.environ.get(ENV_LMSTUDIO_API_KEY)

    def _auth_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def status(self) -> ProviderStatus:
        url = f"{self._base}/models"
        headers = self._auth_headers()
        try:
            status, _body = self._transport("GET", url, headers, None, _STATUS_TIMEOUT)
        except ConnectionRefusedError:
            return ProviderStatus(False, f"LM Studio is not running at {self._base}")
        except OSError as exc:
            if is_connection_refused(exc):
                return ProviderStatus(False, f"LM Studio is not running at {self._base}")
            return ProviderStatus(False, str(exc) or "LM Studio status check failed")
        except Exception as exc:
            if is_connection_refused(exc):
                return ProviderStatus(False, f"LM Studio is not running at {self._base}")
            return ProviderStatus(False, str(exc) or "LM Studio status check failed")
        if 200 <= status < 300:
            return ProviderStatus(True, "")
        return ProviderStatus(False, f"LM Studio returned HTTP {status}")

    def is_available(self) -> bool:
        return self.status().available

    def list_models(self) -> list[Model]:
        url = f"{self._base}/models"
        headers = self._auth_headers()
        try:
            status, body = self._transport("GET", url, headers, None, _STATUS_TIMEOUT)
        except Exception:
            return list(self._models)
        if status < 200 or status >= 300:
            return list(self._models)
        try:
            import json

            payload = json.loads(body)
        except json.JSONDecodeError:
            return list(self._models)
        data = payload.get("data")
        if not isinstance(data, list):
            return list(self._models)
        out: list[Model] = []
        for item in data:
            if isinstance(item, dict):
                model_id = item.get("id")
                if isinstance(model_id, str) and model_id:
                    out.append(Model(id=model_id, label=model_id))
        return out if out else list(self._models)

    def stream(self, request: ProviderRequest, on_delta: DeltaFn) -> ProviderResult:
        url = f"{self._base}/chat/completions"
        body_bytes = chat_completions_json_body(request, stream=True)
        headers = self._auth_headers()
        try:
            status, line_iter = self._stream_transport(
                "POST", url, headers, body_bytes, _RUN_TIMEOUT
            )
        except ConnectionRefusedError:
            raise ProviderError(f"LM Studio is not running at {self._base}")
        except TimeoutError:
            raise ProviderError("LM Studio request timed out")
        except OSError as exc:
            if is_connection_refused(exc):
                raise ProviderError(f"LM Studio is not running at {self._base}")
            raise ProviderError(str(exc) or "LM Studio request failed")
        except Exception as exc:
            if is_connection_refused(exc):
                raise ProviderError(f"LM Studio is not running at {self._base}")
            raise
        if status in (401, 403):
            err_body = b"".join(line_iter)
            excerpt = redact_secret(
                err_body.decode("utf-8", errors="replace")[:200], self._api_key
            )
            raise ProviderError(
                f"LM Studio rejected the request (HTTP {status}): {excerpt}"
            )
        if status >= 400:
            err_body = b"".join(line_iter)
            raise ProviderError(error_excerpt(status, err_body, self._api_key))
        text = iter_chat_completions_sse(line_iter, on_delta, secret=self._api_key)
        return ProviderResult(markdown=text)

    def run(self, request: ProviderRequest) -> ProviderResult:
        url = f"{self._base}/chat/completions"
        body_bytes = chat_completions_json_body(request)
        headers = self._auth_headers()
        try:
            status, resp_body = self._transport(
                "POST", url, headers, body_bytes, _RUN_TIMEOUT
            )
        except ConnectionRefusedError:
            raise ProviderError(f"LM Studio is not running at {self._base}")
        except TimeoutError:
            raise ProviderError("LM Studio request timed out")
        except OSError as exc:
            if is_connection_refused(exc):
                raise ProviderError(f"LM Studio is not running at {self._base}")
            raise ProviderError(str(exc) or "LM Studio request failed")
        except Exception as exc:
            if is_connection_refused(exc):
                raise ProviderError(f"LM Studio is not running at {self._base}")
            raise
        if status in (401, 403):
            excerpt = redact_secret(
                resp_body.decode("utf-8", errors="replace")[:200], self._api_key
            )
            raise ProviderError(
                f"LM Studio rejected the request (HTTP {status}): {excerpt}"
            )
        if status >= 400:
            raise ProviderError(error_excerpt(status, resp_body, self._api_key))
        payload = parse_json_body(resp_body, "LM Studio returned malformed JSON")
        text = parse_chat_completions_content(payload, "LM Studio")
        return ProviderResult(markdown=text)

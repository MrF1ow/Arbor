from __future__ import annotations

import os

from arbor_worker.provider.base import (
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
)
from arbor_worker.provider.openai_compat import (
    chat_completions_json_body,
    parse_chat_completions_content,
)

OPENAI_API_DOCS_URL = "https://platform.openai.com/docs/api-reference/chat"
ENV_OPENAI_BASE_URL = "ARBOR_OPENAI_BASE_URL"
ENV_OPENAI_API_KEY = "ARBOR_OPENAI_API_KEY"
DEFAULT_OPENAI_BASE = "https://api.openai.com/v1"

DEFAULT_OPENAI_API_MODELS = [
    Model(id="gpt-5.6-sol", label="Sol 5.6"),
    Model(id="gpt-5.6-terra", label="Terra 5.6"),
]

_RUN_TIMEOUT = 120.0


class OpenAiApiProvider:
    name = "openai_api"

    def __init__(
        self,
        models: list[Model],
        *,
        transport=None,
        base_url: str | None = None,
        api_key: str | None = None,
    ):
        self._models = models if models else list(DEFAULT_OPENAI_API_MODELS)
        self._transport = transport if transport is not None else urllib_http_request
        self._base = strip_trailing_slash(
            base_url or os.environ.get(ENV_OPENAI_BASE_URL) or DEFAULT_OPENAI_BASE
        )
        if api_key is not None:
            self._api_key = api_key
        else:
            self._api_key = os.environ.get(ENV_OPENAI_API_KEY)

    def _resolved_key(self) -> str | None:
        if self._api_key is None:
            return None
        if self._api_key == "":
            return None
        return self._api_key

    def status(self) -> ProviderStatus:
        key = self._resolved_key()
        if not key:
            return ProviderStatus(False, "key missing")
        return ProviderStatus(True, "")

    def is_available(self) -> bool:
        return self.status().available

    def list_models(self) -> list[Model]:
        return list(self._models)

    def run(self, request: ProviderRequest) -> ProviderResult:
        key = self._resolved_key()
        if not key:
            raise ProviderError("key missing")
        url = f"{self._base}/chat/completions"
        body_bytes = chat_completions_json_body(request)
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        }
        try:
            status, resp_body = self._transport(
                "POST", url, headers, body_bytes, _RUN_TIMEOUT
            )
        except ProviderError:
            raise
        except ConnectionRefusedError:
            raise ProviderError(f"Could not reach OpenAI API at {self._base}")
        except TimeoutError:
            raise ProviderError("OpenAI API request timed out")
        except OSError as exc:
            if is_connection_refused(exc):
                raise ProviderError(f"Could not reach OpenAI API at {self._base}")
            raise
        if status in (401, 403):
            raise ProviderError(f"OpenAI API key was rejected (HTTP {status})")
        if status >= 400:
            raise ProviderError(error_excerpt(status, resp_body, key))
        payload = parse_json_body(resp_body, "OpenAI API returned malformed JSON")
        text = parse_chat_completions_content(payload, "OpenAI API")
        return ProviderResult(markdown=text)

from __future__ import annotations

import base64
import json
from pathlib import Path

from collections.abc import Iterator

from arbor_worker.provider.base import DeltaFn, ProviderError, ProviderRequest, image_media_type
from arbor_worker.provider.http_transport import redact_secret


def build_chat_completions_body(request: ProviderRequest, *, stream: bool = False) -> dict:
    messages: list[dict] = []
    if request.system is not None:
        messages.append({"role": "system", "content": request.system})
    if request.image_paths:
        content: list[dict] = [{"type": "text", "text": request.prompt}]
        for path in request.image_paths:
            if not path.is_file():
                raise ProviderError(f"image not found: {path}")
            data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
            media = image_media_type(path)
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{media};base64,{data}"},
                }
            )
        messages.append({"role": "user", "content": content})
    else:
        messages.append({"role": "user", "content": request.prompt})
    return {
        "model": request.model_id,
        "messages": messages,
        "stream": stream,
    }


def _sse_error_message(payload: dict, secret: str | None) -> str | None:
    error_obj = payload.get("error")
    if not isinstance(error_obj, dict):
        return None
    message = error_obj.get("message")
    if isinstance(message, str) and message.strip():
        return redact_secret(message.strip(), secret)
    return redact_secret(json.dumps(error_obj, ensure_ascii=False), secret)


def iter_chat_completions_sse(
    lines: Iterator[bytes], on_delta: DeltaFn, *, secret: str | None = None
) -> str:
    parts: list[str] = []
    for raw in lines:
        line = raw.decode("utf-8", errors="replace").strip()
        if not line or line.startswith(":"):
            continue
        if line == "data: [DONE]":
            break
        if not line.startswith("data: "):
            continue
        try:
            payload = json.loads(line[6:])
        except json.JSONDecodeError as exc:
            raise ProviderError("chat completion stream returned invalid JSON") from exc
        if not isinstance(payload, dict):
            continue
        err_msg = _sse_error_message(payload, secret)
        if err_msg is not None:
            raise ProviderError(err_msg)
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices:
            continue
        choice0 = choices[0]
        if not isinstance(choice0, dict):
            continue
        delta = choice0.get("delta")
        if not isinstance(delta, dict):
            continue
        text = delta.get("content")
        if isinstance(text, str) and text:
            on_delta(text)
            parts.append(text)
    joined = "".join(parts)
    if not joined.strip():
        raise ProviderError("chat completion stream returned empty text")
    return joined


def parse_chat_completions_content(payload: dict, provider_label: str) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ProviderError(f"{provider_label} response did not include assistant text")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        raise ProviderError(f"{provider_label} response did not include assistant text")
    content = message.get("content")
    if isinstance(content, str) and content:
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                text = part.get("text")
                if isinstance(text, str):
                    parts.append(text)
        joined = "".join(parts)
        if joined:
            return joined
    raise ProviderError(f"{provider_label} response did not include assistant text")


def chat_completions_json_body(request: ProviderRequest, *, stream: bool = False) -> bytes:
    return json.dumps(build_chat_completions_body(request, stream=stream)).encode("utf-8")

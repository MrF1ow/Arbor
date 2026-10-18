from __future__ import annotations

import base64
import json
from pathlib import Path

from arbor_worker.provider.base import ProviderError, ProviderRequest, image_media_type


def build_chat_completions_body(request: ProviderRequest) -> dict:
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
        "stream": False,
    }


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


def chat_completions_json_body(request: ProviderRequest) -> bytes:
    return json.dumps(build_chat_completions_body(request)).encode("utf-8")

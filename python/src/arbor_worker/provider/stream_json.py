from __future__ import annotations

import json
from collections.abc import Iterable

from arbor_worker.provider.base import DeltaFn, ProviderError
def _tool_call_from_stream_event(event: dict, label: str) -> None:
    event_type = event.get("type")
    if event_type == "content_block_start":
        block = event.get("content_block")
        if isinstance(block, dict) and block.get("type") == "tool_use":
            name = block.get("name") or block.get("toolName") or "tool_use"
            raise ProviderError(f"{label} reported a tool call ({name})")
    if event_type == "content_block_delta":
        delta = event.get("delta")
        if isinstance(delta, dict) and delta.get("type") == "thinking_delta":
            return


def _tool_call_from_assistant(payload: dict, label: str) -> None:
    message = payload.get("message")
    if not isinstance(message, dict):
        return
    content = message.get("content")
    if not isinstance(content, list):
        return
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            name = block.get("name") or block.get("toolName") or "tool_use"
            raise ProviderError(f"{label} reported a tool call ({name})")


def iter_stream_json(lines: Iterable[str], on_delta: DeltaFn, *, label: str) -> str:
    delta_parts: list[str] = []
    result_text: str | None = None

    def emit(text: str) -> None:
        if not text:
            return
        on_delta(text)
        delta_parts.append(text)

    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ProviderError(f"{label} returned invalid stream JSON") from exc
        if not isinstance(payload, dict):
            raise ProviderError(f"{label} returned invalid stream JSON")

        line_type = payload.get("type")
        if line_type == "error":
            msg = payload.get("message")
            if isinstance(msg, str) and msg.strip():
                raise ProviderError(msg.strip())
            raise ProviderError(f"{label} stream error")

        if line_type == "stream_event":
            event = payload.get("event")
            if not isinstance(event, dict):
                continue
            _tool_call_from_stream_event(event, label)
            if event.get("type") == "content_block_delta":
                delta = event.get("delta")
                if isinstance(delta, dict) and delta.get("type") == "text_delta":
                    text = delta.get("text")
                    if isinstance(text, str) and text:
                        emit(text)
            continue

        if line_type == "assistant":
            _tool_call_from_assistant(payload, label)
            continue

        if line_type == "result":
            if payload.get("is_error"):
                msg = payload.get("result") or payload.get("message") or f"{label} error"
                raise ProviderError(str(msg).strip())
            raw_result = payload.get("result")
            if isinstance(raw_result, str):
                result_text = raw_result
            continue

    if result_text is not None:
        final = result_text
    else:
        final = "".join(delta_parts)
    if not final.strip():
        raise ProviderError(f"{label} returned empty result")
    return final

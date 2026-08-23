from __future__ import annotations

import json
from collections.abc import Callable
from typing import Protocol

from pydantic import BaseModel, ValidationError

from arbor_worker.provider.base import CliProvider, ProviderRequest


class StudySkill(Protocol):
    name: str

    def build_prompt(self, *, course: str, digest_text: str) -> str: ...

    def validate(self, payload: dict) -> BaseModel: ...


def parse_and_validate(markdown: str, skill: StudySkill) -> BaseModel:
    payload = json.loads(markdown)
    return skill.validate(payload)


def run_with_retries(
    provider: CliProvider,
    request: ProviderRequest,
    skill: StudySkill,
    attempts: int = 3,
    on_retry: Callable[[int, Exception], None] | None = None,
) -> BaseModel:
    last_error: ValueError | None = None
    for attempt in range(attempts):
        result = provider.run(request)
        try:
            return parse_and_validate(result.markdown, skill)
        except (json.JSONDecodeError, ValidationError, ValueError) as error:
            last_error = error
            if on_retry is not None and attempt + 1 < attempts:
                on_retry(attempt + 2, error)
    if last_error is None:
        raise ValueError("attempts must be at least 1")
    raise last_error


def run_skill(
    provider: CliProvider,
    request: ProviderRequest,
    skill: StudySkill,
    attempts: int = 3,
    on_retry: Callable[[int, Exception], None] | None = None,
) -> BaseModel:
    return run_with_retries(provider, request, skill, attempts, on_retry)

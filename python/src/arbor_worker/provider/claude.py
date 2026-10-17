from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
from pathlib import Path

from arbor_worker.auth import check_cli_auth, gui_path, resolve_cli_command
from arbor_worker.provider.base import (
    Model,
    ProviderError,
    ProviderRequest,
    ProviderResult,
    ProviderStatus,
    image_media_type,
)

CLAUDE_DOCS_URL = "https://code.claude.com/docs"
CLAUDECODE_GUARD = "Claude provider disabled inside a Claude Code session"

DEFAULT_CLAUDE_MODELS = [
    Model(id="claude-sonnet-5-5", label="Sonnet 5.5"),
    Model(id="claude-opus-5-5", label="Opus 5.5"),
    Model(id="claude-haiku-5-5", label="Haiku 5.5"),
]


class ClaudeCliProvider:
    name = "claude"

    def __init__(self, models: list[Model], runner=subprocess.run, which=shutil.which):
        self._models = models
        self._runner = runner
        self._which = which

    def _guard_active(self) -> bool:
        return os.environ.get("CLAUDECODE") == "1"

    def status(self) -> ProviderStatus:
        if self._guard_active():
            return ProviderStatus(False, CLAUDECODE_GUARD)
        cmd = resolve_cli_command("claude", self._which)
        if cmd is None:
            return ProviderStatus(False, "Claude CLI not found on PATH")
        res = check_cli_auth(
            [cmd, "auth", "status"],
            runner=self._runner,
            timeout_reason="Claude CLI auth status timeout",
            failure_reason="Claude CLI is not authenticated",
        )
        return ProviderStatus(res.ok, res.reason)

    def is_available(self) -> bool:
        return self.status().available

    def list_models(self) -> list[Model]:
        return list(self._models)

    def build_argv(self, request: ProviderRequest) -> list[str]:
        cmd = resolve_cli_command("claude", self._which)
        argv = [
            cmd,
            "-p",
            "--model",
            request.model_id,
            "--output-format",
            "json",
            "--tools",
            "",
            "--no-session-persistence",
            "--setting-sources",
            "",
            "--strict-mcp-config",
        ]
        if request.image_paths:
            argv.append("--input-format")
            argv.append("stream-json")
        return argv

    def _stdin_payload(self, request: ProviderRequest) -> str:
        if not request.image_paths:
            return request.prompt
        content: list[dict] = [{"type": "text", "text": request.prompt}]
        for path in request.image_paths:
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
        line = {
            "type": "user",
            "message": {"role": "user", "content": content},
        }
        return json.dumps(line) + "\n"

    def run(self, request: ProviderRequest) -> ProviderResult:
        if self._guard_active():
            raise ProviderError(CLAUDECODE_GUARD)
        argv = self.build_argv(request)
        env = os.environ.copy()
        env["PATH"] = gui_path()
        proc = self._runner(
            argv,
            input=self._stdin_payload(request),
            capture_output=True,
            text=True,
            cwd=request.cwd,
        )
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or "").strip()
            raise ProviderError(f"claude failed ({proc.returncode}): {detail}")
        try:
            payload = json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            raise ProviderError(f"claude returned invalid JSON: {exc}") from exc
        if payload.get("is_error"):
            raise ProviderError(
                (payload.get("result") or payload.get("message") or "claude error").strip()
            )
        result = payload.get("result")
        if not isinstance(result, str) or not result.strip():
            raise ProviderError("claude returned empty result")
        return ProviderResult(markdown=result)

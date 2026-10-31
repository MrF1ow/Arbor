from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
from pathlib import Path

from arbor_worker.auth import check_cli_auth, gui_path, resolve_cli_command
from arbor_worker.provider.base import (
    DeltaFn,
    Model,
    ProviderError,
    ProviderRequest,
    ProviderResult,
    ProviderStatus,
    image_media_type,
)
from arbor_worker.provider.cli_stream import run_popen_stream
from arbor_worker.provider.errors import cli_process_failure, message_failure
from arbor_worker.provider.stream_json import iter_stream_json

CLAUDE_DOCS_URL = "https://code.claude.com/docs"
CLAUDECODE_GUARD = "Claude provider disabled inside a Claude Code session"

DEFAULT_CLAUDE_MODELS = [
    Model(id="claude-sonnet-5-5", label="Sonnet 5.5"),
    Model(id="claude-opus-5-5", label="Opus 5.5"),
    Model(id="claude-haiku-5-5", label="Haiku 5.5"),
]


class ClaudeCliProvider:
    name = "claude"

    def __init__(
        self,
        models: list[Model],
        runner=subprocess.run,
        which=shutil.which,
        popen=subprocess.Popen,
    ):
        self._models = models
        self._runner = runner
        self._which = which
        self._popen = popen

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
        if request.system is not None:
            argv.extend(["--system-prompt", request.system])
        return argv

    def build_stream_argv(self, request: ProviderRequest) -> list[str]:
        argv = self.build_argv(request)
        idx = argv.index("--output-format")
        argv[idx + 1] = "stream-json"
        insert_at = idx + 2
        for flag in ("--verbose", "--include-partial-messages"):
            argv.insert(insert_at, flag)
            insert_at += 1
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
        if resolve_cli_command("claude", self._which) is None:
            raise ProviderError("Claude CLI not found on PATH")
        argv = self.build_argv(request)
        env = os.environ.copy()
        env["PATH"] = gui_path()
        proc = self._runner(
            argv,
            input=self._stdin_payload(request),
            capture_output=True,
            text=True,
            cwd=request.cwd,
            env=env,
        )
        if proc.returncode != 0:
            raise cli_process_failure(
                "claude",
                proc.returncode,
                proc.stderr or proc.stdout or "",
            )
        try:
            payload = json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            raise ProviderError(f"claude returned invalid JSON: {exc}") from exc
        if payload.get("is_error"):
            raise message_failure(
                "claude",
                (payload.get("result") or payload.get("message") or "claude error").strip(),
                exit_code=proc.returncode,
            )
        result = payload.get("result")
        if not isinstance(result, str) or not result.strip():
            raise ProviderError("claude returned empty result")
        return ProviderResult(markdown=result)

    def stream(self, request: ProviderRequest, on_delta: DeltaFn) -> ProviderResult:
        if self._guard_active():
            raise ProviderError(CLAUDECODE_GUARD)
        if resolve_cli_command("claude", self._which) is None:
            raise ProviderError("Claude CLI not found on PATH")
        argv = self.build_stream_argv(request)
        env = os.environ.copy()
        env["PATH"] = gui_path()
        stdin_text = self._stdin_payload(request)

        def parse_stdout(lines, delta_fn: DeltaFn) -> str:
            return iter_stream_json(lines, delta_fn, label="claude")

        markdown = run_popen_stream(
            popen=self._popen,
            argv=argv,
            cwd=request.cwd,
            env=env,
            stdin_text=stdin_text,
            on_delta=on_delta,
            parse_stdout=parse_stdout,
            label="claude",
        )
        return ProviderResult(markdown=markdown)

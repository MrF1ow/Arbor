from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import tempfile
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

GROK_DOCS_URL = "https://x.ai/grok"

DEFAULT_GROK_MODELS = [
    Model(id="grok-4.7", label="Grok 4.7"),
    Model(id="grok-4.7-build-fast", label="Grok 4.7 Build Fast"),
]

GROK_DISALLOWED_TOOLS = (
    "run_terminal_cmd,write,search_replace,task,web_search,web_fetch,"
    "read_file,grep,list_dir,todo_write,monitor,search_tool,use_tool,"
    "workflow,enter_plan_mode,exit_plan_mode,ask_user_question,send_feedback,"
    "image_gen,image_edit,image_to_video,reference_to_video"
)


def _iter_payload_nodes(payload: dict):
    yield payload
    for value in payload.values():
        if isinstance(value, dict):
            yield from _iter_payload_nodes(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    yield from _iter_payload_nodes(item)


def _raise_if_tool_call(payload: dict) -> None:
    if payload.get("stopReason") == "max_turn_requests":
        thought = payload.get("thought")
        msg = (
            "grok consumed the allowed turn on a tool call (stopReason max_turn_requests)"
        )
        if isinstance(thought, str) and thought.strip():
            msg = f"{msg}: {thought.strip()}"
        raise ProviderError(msg)

    for node in _iter_payload_nodes(payload):
        node_type = node.get("type")
        if node_type in ("tool_call", "tool_use"):
            tool = node.get("toolName") or node.get("name") or node_type
            raise ProviderError(f"grok reported a tool call ({tool})")
        tool_name = node.get("toolName")
        if isinstance(tool_name, str) and tool_name.strip():
            raise ProviderError(f"grok reported a tool call ({tool_name.strip()})")
        tool_calls = node.get("tool_calls")
        if tool_calls:
            raise ProviderError(f"grok reported tool_calls ({tool_calls!r})")


class GrokCliProvider:
    name = "grok"

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

    def status(self) -> ProviderStatus:
        cmd = resolve_cli_command("grok", self._which)
        if cmd is None:
            return ProviderStatus(False, "Grok CLI not found on PATH")
        res = check_cli_auth(
            [cmd, "models"],
            runner=self._runner,
            timeout_reason="Grok CLI models timeout",
            failure_reason="Grok CLI is not authenticated",
            ok=lambda proc: proc.returncode == 0 and "logged in" in (proc.stdout or "").lower(),
        )
        return ProviderStatus(res.ok, res.reason)

    def is_available(self) -> bool:
        return self.status().available

    def list_models(self) -> list[Model]:
        return list(self._models)

    def build_argv(self, request: ProviderRequest, prompt_file: Path | None) -> list[str]:
        cmd = resolve_cli_command("grok", self._which)
        argv = [cmd]
        if prompt_file is not None:
            argv.extend(["--prompt-file", str(prompt_file)])
        argv.extend(
            [
                "-m",
                request.model_id,
                "--output-format",
                "json",
                "--disable-web-search",
                "--no-subagents",
                "--no-plan",
                "--max-turns",
                "1",
                "--permission-mode",
                "dontAsk",
                "--cwd",
                str(request.cwd),
                "--verbatim",
                "--disallowed-tools",
                GROK_DISALLOWED_TOOLS,
            ]
        )
        if request.system is not None:
            argv.extend(["--system-prompt-override", request.system])
        return argv

    def build_stream_argv(self, request: ProviderRequest, prompt_file: Path | None) -> list[str]:
        argv = self.build_argv(request, prompt_file=prompt_file)
        idx = argv.index("--output-format")
        argv[idx + 1] = "streaming-messages-json"
        argv.insert(idx + 2, "--include-partial-messages")
        return argv

    def _parse_stdout(self, stdout: str) -> ProviderResult:
        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise ProviderError(f"grok returned invalid JSON: {exc}") from exc
        if payload.get("type") == "error" or payload.get("is_error"):
            raise message_failure("grok", str(payload.get("message") or "grok error"))
        _raise_if_tool_call(payload)
        text = payload.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ProviderError("grok returned empty text")
        return ProviderResult(markdown=text)

    def run(self, request: ProviderRequest) -> ProviderResult:
        if resolve_cli_command("grok", self._which) is None:
            raise ProviderError("Grok CLI not found on PATH")
        env = os.environ.copy()
        env["PATH"] = gui_path()
        if request.image_paths:
            blocks: list[dict] = [{"type": "text", "text": request.prompt}]
            for path in request.image_paths:
                data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
                blocks.append(
                    {
                        "type": "image",
                        "mimeType": image_media_type(path),
                        "data": data,
                    }
                )
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                delete=False,
                suffix=".json",
            ) as tmp:
                tmp.write(json.dumps(blocks))
                prompt_path = Path(tmp.name)
        else:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                delete=False,
                suffix=".txt",
            ) as tmp:
                tmp.write(request.prompt)
                prompt_path = Path(tmp.name)
        try:
            argv = self.build_argv(request, prompt_file=prompt_path)
            proc = self._runner(
                argv,
                capture_output=True,
                text=True,
                env=env,
            )
        finally:
            prompt_path.unlink(missing_ok=True)
        if proc.returncode != 0:
            stdout = proc.stdout or ""
            try:
                payload = json.loads(stdout)
            except json.JSONDecodeError:
                payload = None
            if isinstance(payload, dict):
                if payload.get("type") == "error" or payload.get("is_error"):
                    raise message_failure(
                        "grok",
                        str(payload.get("message") or "grok error"),
                        exit_code=proc.returncode,
                    )
                _raise_if_tool_call(payload)
            raise cli_process_failure(
                "grok",
                proc.returncode,
                proc.stderr or proc.stdout or "",
            )
        return self._parse_stdout(proc.stdout or "")

    def stream(self, request: ProviderRequest, on_delta: DeltaFn) -> ProviderResult:
        if resolve_cli_command("grok", self._which) is None:
            raise ProviderError("Grok CLI not found on PATH")
        env = os.environ.copy()
        env["PATH"] = gui_path()
        if request.image_paths:
            blocks: list[dict] = [{"type": "text", "text": request.prompt}]
            for path in request.image_paths:
                data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
                blocks.append(
                    {
                        "type": "image",
                        "mimeType": image_media_type(path),
                        "data": data,
                    }
                )
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                delete=False,
                suffix=".json",
            ) as tmp:
                tmp.write(json.dumps(blocks))
                prompt_path = Path(tmp.name)
        else:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                delete=False,
                suffix=".txt",
            ) as tmp:
                tmp.write(request.prompt)
                prompt_path = Path(tmp.name)
        try:
            argv = self.build_stream_argv(request, prompt_file=prompt_path)

            def parse_stdout(lines, delta_fn: DeltaFn) -> str:
                return iter_stream_json(lines, delta_fn, label="grok")

            markdown = run_popen_stream(
                popen=self._popen,
                argv=argv,
                cwd=request.cwd,
                env=env,
                stdin_text="",
                on_delta=on_delta,
                parse_stdout=parse_stdout,
                label="grok",
            )
        finally:
            prompt_path.unlink(missing_ok=True)
        return ProviderResult(markdown=markdown)

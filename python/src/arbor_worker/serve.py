"""Long-lived NDJSON worker for short arbor-worker subcommands."""

from __future__ import annotations

import contextlib
import io
import json
import os
import select
import sys
import traceback
from typing import Any, TextIO

import arbor_worker.commands  # noqa: F401 — pre-import for warm requests

from arbor_worker import cli


def _serve_eligible(argv: list[str]) -> bool:
    if not argv:
        return False
    cmd = argv[0]
    if cmd == "library-show":
        return True
    if cmd == "sync":
        return "--show" in argv[1:]
    if cmd == "study-progress":
        return True
    if cmd in ("study-plan", "append-card", "list-models", "skill-index"):
        return True
    return False


def _run_selftest_fd1() -> int:
    os.system("echo hi")
    return 0


def _handle_request(argv: list[str], env: dict[str, str]) -> tuple[int, str, str]:
    if (
        os.environ.get("ARBOR_SERVE_TEST") == "1"
        and argv == ["--selftest-fd1"]
    ):
        code = _run_selftest_fd1()
        return code, "", ""

    if not _serve_eligible(argv):
        return 64, "", "not serve-eligible"

    snapshot = dict(os.environ)
    added_keys: list[str] = []
    for key, value in env.items():
        if key not in snapshot:
            added_keys.append(key)
        os.environ[key] = value

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    exit_code = 0
    real_stdin = sys.stdin
    sys.stdin = io.StringIO("")
    try:
        with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
            try:
                exit_code = cli.main(argv)
            except SystemExit as exc:
                code = exc.code
                if isinstance(code, int):
                    exit_code = code
                elif code is None:
                    exit_code = 0
                else:
                    exit_code = 1
            except BaseException:
                exit_code = 70
                traceback.print_exc(file=stderr_buf)
    finally:
        sys.stdin = real_stdin
        for key in list(os.environ.keys()):
            if key not in snapshot:
                del os.environ[key]
        for key, value in snapshot.items():
            os.environ[key] = value

    return exit_code, stdout_buf.getvalue(), stderr_buf.getvalue()


def _write_response(proto: TextIO, payload: dict[str, Any]) -> None:
    proto.write(json.dumps(payload, ensure_ascii=False) + "\n")
    proto.flush()


def serve_loop(
    *,
    stdin_fd: int | None = None,
    idle_secs: float | None = None,
) -> int:
    if idle_secs is None:
        idle_secs = float(os.environ.get("ARBOR_SERVE_IDLE_SECS", "600"))

    proto = os.fdopen(os.dup(1), "w", buffering=1)
    os.dup2(2, 1)

    if stdin_fd is None:
        stdin_fd = sys.stdin.fileno()
    stdin_file = os.fdopen(os.dup(stdin_fd), "r", buffering=1)

    while True:
        ready, _, _ = select.select([stdin_file], [], [], idle_secs)
        if not ready:
            return 0
        line = stdin_file.readline()
        if not line:
            return 0
        text = line.strip()
        if not text:
            continue
        try:
            req = json.loads(text)
        except json.JSONDecodeError:
            _write_response(
                proto,
                {
                    "id": -1,
                    "exit": 65,
                    "stdout": "",
                    "stderr": "invalid request json",
                },
            )
            continue

        req_id = req.get("id", -1)
        argv = req.get("argv") or []
        env = req.get("env") or {}
        if not isinstance(argv, list) or not all(isinstance(x, str) for x in argv):
            _write_response(
                proto,
                {
                    "id": req_id,
                    "exit": 65,
                    "stdout": "",
                    "stderr": "invalid argv",
                },
            )
            continue
        if not isinstance(env, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in env.items()
        ):
            _write_response(
                proto,
                {
                    "id": req_id,
                    "exit": 65,
                    "stdout": "",
                    "stderr": "invalid env",
                },
            )
            continue

        exit_code, out, err = _handle_request(list(argv), dict(env))
        _write_response(
            proto,
            {"id": req_id, "exit": exit_code, "stdout": out, "stderr": err},
        )


def main() -> int:
    return serve_loop()


if __name__ == "__main__":
    raise SystemExit(main())

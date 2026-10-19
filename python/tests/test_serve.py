from __future__ import annotations

import json
import os
import select
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pytest

from arbor_worker import serve


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "serve@test"],
        cwd=root,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "serve"],
        cwd=root,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "commit", "--allow-empty", "-m", "init"],
        cwd=root,
        check=True,
        capture_output=True,
    )


def _serve_proc(idle_secs: str | None = None) -> subprocess.Popen[str]:
    env = os.environ.copy()
    if idle_secs is not None:
        env["ARBOR_SERVE_IDLE_SECS"] = idle_secs
    return subprocess.Popen(
        [sys.executable, "-m", "arbor_worker", "serve"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        env=env,
    )


def _round_trip(proc: subprocess.Popen[str], payload: dict) -> dict:
    assert proc.stdin and proc.stdout
    proc.stdin.write(json.dumps(payload) + "\n")
    proc.stdin.flush()
    line = proc.stdout.readline()
    return json.loads(line)


def test_library_show_round_trip() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "lib"
        root.mkdir()
        _init_repo(root)
        proc = _serve_proc("600")
        try:
            resp = _round_trip(
                proc,
                {
                    "id": 1,
                    "argv": ["library-show", "--root", str(root)],
                    "env": {},
                },
            )
            assert resp["id"] == 1
            assert resp["exit"] == 0
            doc = json.loads(resp["stdout"].strip().splitlines()[-1])
            assert "library" in doc or isinstance(doc, dict)
        finally:
            proc.stdin.close()
            proc.wait(timeout=10)


def test_env_isolation_between_requests() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "lib"
        root.mkdir()
        _init_repo(root)
        argv = ["library-show", "--root", str(root)]
        serve._handle_request(argv, {"ARBOR_SERVE_PROBE": "1"})
        serve._handle_request(argv, {})
        assert os.environ.get("ARBOR_SERVE_PROBE") is None


def test_rejected_command_exit_64() -> None:
    proc = _serve_proc("600")
    try:
        resp = _round_trip(
            proc,
            {"id": 3, "argv": ["check-auth"], "env": {}},
        )
        assert resp["exit"] == 64
        assert "not serve-eligible" in resp["stderr"]
    finally:
        proc.stdin.close()
        proc.wait(timeout=10)


def test_system_exit_mapped(monkeypatch: pytest.MonkeyPatch) -> None:
    import arbor_worker.cli as cli

    def boom(_argv: list[str] | None = None) -> int:
        raise SystemExit(42)

    monkeypatch.setattr(cli, "main", boom)
    code, out, err = serve._handle_request(["library-show", "--root", "/tmp"], {})
    assert code == 42
    assert out == ""
    assert err == ""


def test_fd1_corruption_guard() -> None:
    env = os.environ.copy()
    env["ARBOR_SERVE_TEST"] = "1"
    proc = subprocess.Popen(
        [sys.executable, "-m", "arbor_worker", "serve"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        env=env,
    )
    try:
        resp = _round_trip(
            proc,
            {"id": 4, "argv": ["--selftest-fd1"], "env": {}},
        )
        assert resp["exit"] == 0
        assert "hi" not in resp.get("stdout", "")
        ready, _, _ = select.select([proc.stdout], [], [], 0.2)
        assert not ready
    finally:
        proc.stdin.close()
        proc.wait(timeout=10)


def test_idle_timeout_exits() -> None:
    proc = _serve_proc("1")
    assert proc.wait(timeout=5) == 0


def _read_response_with_timeout(stdout, *, deadline: float = 5.0) -> dict:
    fd = stdout.fileno()
    buf = b""
    end = time.monotonic() + deadline
    while b"\n" not in buf:
        remaining = end - time.monotonic()
        assert remaining > 0, "timed out waiting for serve response"
        ready, _, _ = select.select([fd], [], [], remaining)
        assert ready, "timed out waiting for serve response"
        chunk = os.read(fd, 65536)
        assert chunk, "serve stdout closed before response"
        buf += chunk
    line, _, _ = buf.partition(b"\n")
    return json.loads(line.decode("utf-8"))


def test_pipelined_requests_one_write() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "lib"
        root.mkdir()
        _init_repo(root)
        proc = _serve_proc("600")
        assert proc.stdin and proc.stdout
        try:
            req1 = json.dumps(
                {
                    "id": 1,
                    "argv": ["library-show", "--root", str(root)],
                    "env": {},
                }
            )
            req2 = json.dumps(
                {
                    "id": 2,
                    "argv": ["library-show", "--root", str(root)],
                    "env": {},
                }
            )
            proc.stdin.write(f"{req1}\n{req2}\n")
            proc.stdin.flush()
            resp1 = _read_response_with_timeout(proc.stdout)
            resp2 = _read_response_with_timeout(proc.stdout)
            assert resp1["id"] == 1
            assert resp2["id"] == 2
            assert resp1["exit"] == 0
            assert resp2["exit"] == 0
        finally:
            proc.stdin.close()
            proc.wait(timeout=10)


def test_split_request_across_writes() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "lib"
        root.mkdir()
        _init_repo(root)
        proc = _serve_proc("600")
        assert proc.stdin and proc.stdout
        try:
            payload = json.dumps(
                {
                    "id": 7,
                    "argv": ["library-show", "--root", str(root)],
                    "env": {},
                }
            )
            half = len(payload) // 2
            proc.stdin.write(payload[:half])
            proc.stdin.flush()
            time.sleep(0.1)
            proc.stdin.write(payload[half:] + "\n")
            proc.stdin.flush()
            resp = _read_response_with_timeout(proc.stdout)
            assert resp["id"] == 7
            assert resp["exit"] == 0
        finally:
            proc.stdin.close()
            proc.wait(timeout=10)


def test_child_processes_cannot_read_protocol_stdin(tmp_path):
    import json
    import select
    import subprocess
    import sys

    env = dict(os.environ, ARBOR_SERVE_TEST="1")
    proc = subprocess.Popen(
        [sys.executable, "-m", "arbor_worker", "serve"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    try:
        # A child reading fd 0 must see /dev/null, not the next request.
        reader = {"id": 1, "argv": ["--selftest-stdin"], "env": {}}
        follow = {"id": 2, "argv": ["skill-index", "--source", str(tmp_path)], "env": {}}
        proc.stdin.write((json.dumps(reader) + "\n" + json.dumps(follow) + "\n").encode())
        proc.stdin.flush()
        ids = []
        buf = b""
        while len(ids) < 2:
            ready, _, _ = select.select([proc.stdout], [], [], 10)
            assert ready, "serve stalled"
            chunk = os.read(proc.stdout.fileno(), 65536)
            assert chunk
            buf += chunk
            while b"\n" in buf:
                line, _, buf = buf.partition(b"\n")
                resp = json.loads(line)
                ids.append(resp["id"])
                if resp["id"] == 1:
                    assert resp["stdout"] == "0\n"
                if resp["id"] == 2:
                    assert resp["exit"] == 64
        assert ids == [1, 2]
    finally:
        proc.stdin.close()
        proc.wait(timeout=20)

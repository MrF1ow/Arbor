from __future__ import annotations

import json
import os
import select
import subprocess
import sys
import tempfile
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

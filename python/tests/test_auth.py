import subprocess

from arbor_worker.auth import check_codex_auth


class FakeCompleted:
    def __init__(self, returncode, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_missing_binary():
    res = check_codex_auth(runner=lambda *a, **k: FakeCompleted(0), which=lambda name: None)
    assert res.ok is False
    assert "not found" in res.reason.lower()


def test_authenticated():
    res = check_codex_auth(
        runner=lambda *a, **k: FakeCompleted(0, stdout="Logged in"),
        which=lambda name: "/usr/bin/codex",
    )
    assert res.ok is True


def test_not_authenticated():
    res = check_codex_auth(
        runner=lambda *a, **k: FakeCompleted(1, stdout="Not logged in"),
        which=lambda name: "/usr/bin/codex",
    )
    assert res.ok is False
    assert "not logged in" in res.reason.lower()

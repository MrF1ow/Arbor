from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
import re

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
_INDEX_PATH = _REPO_ROOT / "marketplace" / "index.json"


def _git(*args: str) -> str:
    env = {**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null"}
    proc = subprocess.run(
        ["git", "-C", str(_REPO_ROOT), *args],
        capture_output=True,
        text=True,
        check=True,
        env=env,
    )
    return proc.stdout.strip()


def test_marketplace_index_pins_anki_export_package() -> None:
    data = json.loads(_INDEX_PATH.read_text(encoding="utf-8"))
    packages = data["packages"]
    assert len(packages) == 1

    entry = packages[0]
    assert entry["id"] == "anki-export"
    assert entry["permissions"] == ["read_course", "write_export_dir"]
    assert entry["subdir"] == "marketplace/packages/anki-export"

    commit = entry["commit"]
    assert re.fullmatch(r"[0-9a-f]{40}", commit)
    # Shallow CI checkouts don't contain the pinned commit; verify it where history exists.
    probe = subprocess.run(
        ["git", "-C", str(_REPO_ROOT), "cat-file", "-t", commit],
        capture_output=True,
        text=True,
        env={**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null"},
    )
    if probe.returncode != 0:
        pytest.skip(f"pinned commit {commit} not in this checkout (shallow clone)")
    assert probe.stdout.strip() == "commit"

    tree_line = _git(
        "ls-tree",
        "-r",
        commit,
        "--",
        "marketplace/packages/anki-export/arbor-skill.json",
    )
    assert tree_line
    assert "arbor-skill.json" in tree_line

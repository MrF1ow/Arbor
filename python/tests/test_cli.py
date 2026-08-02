import io
import contextlib

from arbor_worker import cli


def run(argv):
    out = io.StringIO()
    err = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def test_version_flag():
    code, out, _ = run(["--version"])
    assert code == 0
    assert "0.1.0" in out


def test_subcommands_registered():
    parser = cli.build_parser()
    # argparse stores subparser choices on the _SubParsersAction
    actions = [a for a in parser._actions if getattr(a, "choices", None)]
    choices = set()
    for a in actions:
        choices.update(a.choices.keys())
    assert {"check-auth", "list-models", "update"}.issubset(choices)


import json as _json
from pathlib import Path


def test_list_models_default(tmp_path):
    code, out, _ = run(["list-models", "--root", str(tmp_path)])
    assert code == 0
    data = _json.loads(out)
    assert "models" in data and len(data["models"]) >= 1
    assert {"id", "label"} <= set(data["models"][0].keys())


def test_update_with_fake_provider_processes(tmp_path, monkeypatch):
    import subprocess
    # build a git repo with one pdf
    root = tmp_path / "K"
    root.mkdir()
    subprocess.run(["git", "-C", str(root), "init", "-q"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.email", "t@a.b"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.name", "T"], check=True)
    (root / ".gitignore").write_text("_arbor_cache/\n")
    subprocess.run(["git", "-C", str(root), "add", ".gitignore"], check=True)
    subprocess.run(["git", "-C", str(root), "commit", "-q", "-m", "init"], check=True)
    import fitz
    d = root / "Bio" / "L1"
    d.mkdir(parents=True)
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "hi")
    doc.save(str(d / "source.pdf"))
    doc.close()

    good = (
        "# L\n## Overview\nlong enough overview sentence here for validation.\n"
        "## Key Concepts\n- a\n## Important Details\n- b\n## Questions to Review\n- c?\n"
    )
    monkeypatch.setenv("ARBOR_FAKE_MD", good)
    code, out, _ = run(["update", "--root", str(root), "--model", "m", "--provider", "fake"])
    assert code == 0
    types = [e["type"] for e in [_json.loads(l) for l in out.splitlines() if l.strip()]]
    assert "committed" in types
    assert (d / "lecture.md").exists()

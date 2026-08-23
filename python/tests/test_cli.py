import io
import contextlib
import json as _json
from pathlib import Path

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
    assert "2.1.0" in out


def test_subcommands_registered():
    parser = cli.build_parser()
    actions = [a for a in parser._actions if getattr(a, "choices", None)]
    choices = set()
    for a in actions:
        choices.update(a.choices.keys())
    assert {"check-auth", "list-models", "update", "plan-update", "generate"}.issubset(choices)


def test_list_models_default(tmp_path):
    code, out, _ = run(["list-models", "--root", str(tmp_path)])
    assert code == 0
    data = _json.loads(out)
    assert "models" in data and len(data["models"]) >= 1
    assert {"id", "label"} <= set(data["models"][0].keys())


def _knowledge_repo_with_pdf(tmp_path, pages=1, name="Biology/mega.pdf"):
    import subprocess

    import fitz

    root = tmp_path / "K"
    root.mkdir()
    subprocess.run(["git", "-C", str(root), "init", "-q"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.email", "t@a.b"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.name", "T"], check=True)
    (root / ".gitignore").write_text("_arbor_cache/\n")
    subprocess.run(["git", "-C", str(root), "add", ".gitignore"], check=True)
    subprocess.run(["git", "-C", str(root), "commit", "-q", "-m", "init"], check=True)

    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    doc = fitz.open()
    for i in range(pages):
        doc.new_page().insert_text((72, 72), f"page {i + 1}")
    doc.save(str(target))
    doc.close()
    return root


def _marked_fake_md(start: int, end: int) -> str:
    body = (
        "# Lecture\n## Overview\nThis is a fake digest overview long enough to validate.\n"
        "## Key Concepts\n- concept\n## Important Details\n- detail\n"
        "## Questions to Review\n- question?\n"
    )
    return (
        f"<!-- arbor-pages:{start}-{end} -->\n"
        f"{body.rstrip()}\n"
        f"<!-- /arbor-pages:{start}-{end} -->\n"
    )


def test_plan_update_lists_pending_sources(tmp_path):
    root = _knowledge_repo_with_pdf(tmp_path, pages=3)
    code, out, _ = run(["plan-update", "--root", str(root)])
    assert code == 0
    data = _json.loads(out)
    assert data["pending"][0]["path"] == "Biology/mega.pdf"
    assert data["pending"][0]["page_count"] == 3
    assert data["pending"][0]["suggested_ranges"] == []
    assert data["pending"][0]["alignment_status"] == "ambiguous"
    assert "suggested_start_page" not in data["pending"][0]


def test_update_with_plan_file_applies_ranges(tmp_path, monkeypatch):
    monkeypatch.setenv("ARBOR_FAKE_MD", _marked_fake_md(3, 4))
    root = _knowledge_repo_with_pdf(tmp_path, pages=4)
    plan_file = tmp_path / "plan.json"
    plan_file.write_text(
        _json.dumps({"selections": [{"path": "Biology/mega.pdf", "ranges": [[3, 4]]}]})
    )

    code, out, _ = run(
        [
            "update",
            "--root", str(root),
            "--model", "m",
            "--provider", "fake",
            "--plan", str(plan_file),
        ]
    )
    assert code == 0
    manifest = _json.loads((root / "Biology" / "arbor-course.json").read_text())
    assert manifest["records"][0]["start_page"] == 3
    assert manifest["records"][0]["end_page"] == 4
    assert (root / "Biology" / "course.md").is_file()


def test_update_without_plan_processes_everything(tmp_path, monkeypatch):
    monkeypatch.setenv("ARBOR_FAKE_MD", _marked_fake_md(1, 2))
    root = _knowledge_repo_with_pdf(tmp_path, pages=2)
    code, _, _ = run(
        ["update", "--root", str(root), "--model", "m", "--provider", "fake"]
    )
    assert code == 0
    manifest = _json.loads((root / "Biology" / "arbor-course.json").read_text())
    assert manifest["records"][0]["start_page"] == 1
    assert manifest["records"][0]["end_page"] == 2
    assert manifest["version"] == 2


def test_update_codex_unauthenticated(tmp_path, monkeypatch):
    from arbor_worker.auth import AuthResult

    root = tmp_path / "K"
    root.mkdir()
    d = root / "Biology"
    d.mkdir(parents=True)
    (d / "source.pdf").write_bytes(b"not-a-real-pdf")

    monkeypatch.setattr(
        "arbor_worker.commands.check_codex_auth",
        lambda: AuthResult(False, "Not logged in"),
    )

    code, out, _ = run(["update", "--root", str(root), "--model", "m", "--provider", "codex"])
    assert code == 3
    events = [_json.loads(line) for line in out.splitlines() if line.strip()]
    assert [e["type"] for e in events] == ["auth_failed"]
    assert events[0]["reason"] == "Not logged in"
    assert not (d / "course.md").exists()

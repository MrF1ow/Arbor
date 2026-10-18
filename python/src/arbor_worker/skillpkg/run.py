from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

from arbor_worker.skillpkg.install import (
    _validate_commit,
    _validate_skill_id,
    skills_root,
)
from arbor_worker.skillpkg.manifest import SkillPackageError, SkillPackageManifest
from arbor_worker.skillpkg.tree import inspect_package_tree
from arbor_worker.study_progress import validate_course_name


class SkillPermissionError(SkillPackageError):
    """Raised when a skill is not confirmed or exceeds its grant."""


_PROVIDER_ENV_NAMES = (
    "ARBOR_OPENAI_API_KEY",
    "ARBOR_ANTHROPIC_API_KEY",
    "ARBOR_LMSTUDIO_API_KEY",
    "ARBOR_OPENAI_BASE_URL",
    "ARBOR_ANTHROPIC_BASE_URL",
    "ARBOR_OLLAMA_BASE_URL",
    "ARBOR_LMSTUDIO_BASE_URL",
)

_LOCALE_ENV_NAMES = ("LANG", "LC_ALL", "LC_CTYPE")


def _stderr_tail(text: str, *, limit: int = 800) -> str:
    stripped = (text or "").strip()
    if len(stripped) <= limit:
        return stripped
    return stripped[-limit:]


def _reject_symlink(path: Path, label: str) -> None:
    try:
        st = os.lstat(path)
    except OSError as error:
        raise SkillPackageError(f"{label} is not available") from error
    if stat.S_ISLNK(st.st_mode):
        raise SkillPackageError(f"{label} must not be a symlink")


def _reject_symlink_ancestors(path: Path, label: str) -> None:
    current = Path(path.anchor)
    for part in path.parts:
        if part in ("", "/"):
            continue
        current = current / part
        _reject_symlink(current, label)


def _require_real_directory(path: Path, label: str) -> Path:
    _reject_symlink(path, label)
    try:
        st = os.lstat(path)
    except OSError as error:
        raise SkillPackageError(f"{label} is not available") from error
    if not stat.S_ISDIR(st.st_mode):
        raise SkillPackageError(f"{label} must be a directory")
    return path.resolve()


def _load_installed_tree(
    skill_id: str, commit: str, *, data_home: Path | None
) -> tuple[Path, SkillPackageManifest]:
    skill_id = _validate_skill_id(skill_id)
    commit = _validate_commit(commit)

    root = skills_root(data_home)
    install_dir = root / skill_id / commit
    if not install_dir.exists():
        raise SkillPackageError("skill is not installed at this commit")
    _reject_symlink_ancestors(install_dir, "skill install path")
    if not install_dir.is_dir():
        raise SkillPackageError("invalid skill install path")
    if install_dir.name != commit:
        raise SkillPackageError("install path does not match commit")

    meta_path = install_dir / "arbor-install.json"
    if not meta_path.is_file() or meta_path.is_symlink():
        raise SkillPackageError("missing install metadata")
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SkillPackageError("invalid install metadata") from error
    if not isinstance(meta, dict):
        raise SkillPackageError("invalid install metadata")
    if meta.get("id") != skill_id or meta.get("commit") != commit:
        raise SkillPackageError("install metadata does not match request")

    manifest = inspect_package_tree(install_dir)
    if manifest.id != skill_id:
        raise SkillPackageError("manifest id does not match request")
    return install_dir, manifest


def _build_child_env(scratch: Path, grants: set[str]) -> dict[str, str]:
    home = scratch / "home"
    tmp = scratch / "tmp"
    home.mkdir(parents=True, exist_ok=True)
    tmp.mkdir(parents=True, exist_ok=True)

    env: dict[str, str] = {
        "HOME": str(home),
        "TMPDIR": str(tmp),
        "XDG_CONFIG_HOME": str(home),
        "XDG_DATA_HOME": str(home),
        "XDG_CACHE_HOME": str(tmp),
        "PYTHONNOUSERSITE": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    path = os.environ.get("PATH")
    if path:
        env["PATH"] = path
    for name in _LOCALE_ENV_NAMES:
        value = os.environ.get(name)
        if value is not None:
            env[name] = value
    if "CLAUDECODE" in os.environ:
        env["CLAUDECODE"] = os.environ["CLAUDECODE"]
    if "provider" in grants:
        for name in _PROVIDER_ENV_NAMES:
            value = os.environ.get(name)
            if value is not None:
                env[name] = value
    return env


_WRITE_SKILL_PERMISSIONS = frozenset({"write_course_study", "write_export_dir"})


def run_installed_skill(
    skill_id: str,
    commit: str,
    *,
    knowledge_root: Path,
    course: str,
    export_dir: Path,
    grants: list[str],
    confirmed: bool,
    data_home: Path | None = None,
) -> None:
    grant_set = set(grants)
    if grant_set & _WRITE_SKILL_PERMISSIONS:
        from arbor_worker.library import assert_can_write

        assert_can_write(knowledge_root)

    install_dir, manifest = _load_installed_tree(skill_id, commit, data_home=data_home)

    if not confirmed:
        raise SkillPermissionError("skill permissions were not confirmed")

    manifest_perms = set(manifest.permissions)
    if grant_set != manifest_perms:
        raise SkillPermissionError("permission grants do not match manifest")

    export_resolved = _require_real_directory(export_dir, "export_dir")
    knowledge_resolved = _require_real_directory(knowledge_root, "knowledge_root")

    validate_course_name(course)
    course_dir = knowledge_root / course
    course_resolved = _require_real_directory(course_dir, "course directory")
    try:
        course_resolved.relative_to(knowledge_resolved)
    except ValueError as error:
        raise SkillPackageError("course directory escapes knowledge root") from error

    request = {
        "package_dir": str(install_dir.resolve()),
        "knowledge_root": str(knowledge_resolved),
        "course": course,
        "export_dir": str(export_resolved),
        "grants": sorted(grant_set),
        "entry": manifest.entry,
    }

    with tempfile.TemporaryDirectory(prefix="arbor-skill-run-") as tmp_name:
        scratch = Path(tmp_name)
        request_path = scratch / "request.json"
        request_path.write_text(json.dumps(request), encoding="utf-8")
        env = _build_child_env(scratch, grant_set)
        proc = subprocess.run(
            [sys.executable, "-m", "arbor_worker.skillpkg.child", str(request_path)],
            env=env,
            cwd=scratch,
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            detail = _stderr_tail(proc.stderr or proc.stdout or "skill run failed")
            raise SkillPackageError(detail)


def cmd_skill_run(args) -> int:
    from pathlib import Path as PathType

    from arbor_worker.library import LibraryError, assert_can_write

    data_home = PathType(args.data_home) if args.data_home else None
    grants = list(args.grant or [])
    grant_set = set(grants)
    if grant_set & _WRITE_SKILL_PERMISSIONS:
        try:
            assert_can_write(PathType(args.root))
        except LibraryError as error:
            print(str(error), file=sys.stderr)
            return 1
    try:
        run_installed_skill(
            args.id,
            args.commit,
            knowledge_root=PathType(args.root),
            course=args.course,
            export_dir=PathType(args.export_dir),
            grants=grants,
            confirmed=bool(args.confirmed),
            data_home=data_home,
        )
    except LibraryError as error:
        print(str(error), file=sys.stderr)
        return 1
    except SkillPermissionError as error:
        print(str(error), file=sys.stderr)
        return 1
    except SkillPackageError as error:
        print(str(error), file=sys.stderr)
        return 1
    payload = {"id": args.id, "commit": args.commit, "ok": True}
    print(json.dumps(payload))
    return 0

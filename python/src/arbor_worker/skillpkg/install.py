from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

from arbor_worker.skillpkg.manifest import SkillPackageError, SkillPackageManifest
from arbor_worker.skillpkg.tree import inspect_package_tree, safe_child

_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_SKILL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


@dataclass(frozen=True)
class InstalledSkill:
    id: str
    commit: str
    path: Path
    manifest: SkillPackageManifest


def skills_root(data_home: Path | None = None) -> Path:
    if data_home is None:
        xdg = os.environ.get("XDG_DATA_HOME")
        base = Path(xdg) if xdg else Path.home() / ".local" / "share"
    else:
        base = data_home
    return base / "arbor" / "skills"


def _validate_commit(commit: str) -> str:
    if not _COMMIT_RE.fullmatch(commit):
        raise SkillPackageError("commit must be a full lowercase 40-character git SHA")
    return commit


def _validate_git_url(git_url: str) -> str:
    if not isinstance(git_url, str) or not git_url:
        raise SkillPackageError("git URL must be a non-empty string")
    if "\n" in git_url or "\x00" in git_url:
        raise SkillPackageError("invalid git URL")
    if git_url.startswith("-"):
        raise SkillPackageError("invalid git URL")
    return git_url


def _validate_subdir(subdir: str) -> str:
    if not subdir or "\x00" in subdir or "\\" in subdir:
        raise SkillPackageError("invalid subdir")
    if subdir.startswith("/") or (len(subdir) > 1 and subdir[1] == ":"):
        raise SkillPackageError("invalid subdir")
    rel = Path(subdir)
    if rel.is_absolute():
        raise SkillPackageError("invalid subdir")
    for part in rel.parts:
        if part in ("", ".", ".."):
            raise SkillPackageError("invalid subdir")
    if ".." in rel.parts:
        raise SkillPackageError("invalid subdir")
    return subdir


def _validate_skill_id(skill_id: str) -> str:
    if not _SKILL_ID_RE.fullmatch(skill_id):
        raise SkillPackageError("invalid skill package id")
    return skill_id


def _git_env() -> dict[str, str]:
    env = os.environ.copy()
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env.pop("GIT_DIR", None)
    env.pop("GIT_WORK_TREE", None)
    return env


def _run_git(args: list[str]) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(
        ["git", "-c", "core.hooksPath=/dev/null", *args],
        capture_output=True,
        text=True,
        env=_git_env(),
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "git command failed").strip()
        raise SkillPackageError(detail)
    return proc


def _reject_absolute_symlinks(root: Path) -> None:
    for dirpath, _dirnames, filenames in os.walk(root, followlinks=False):
        current = Path(dirpath)
        for name in filenames:
            entry = current / name
            if entry.is_symlink() and entry.readlink().is_absolute():
                raise SkillPackageError("absolute symlinks are not allowed")


def _inside_root(candidate: Path, root: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _prepare_skills_root(data_home: Path | None) -> tuple[Path, Path]:
    root = skills_root(data_home)
    arbor_dir = root.parent
    if arbor_dir.is_symlink() or root.is_symlink():
        raise SkillPackageError("invalid skills root")
    arbor_dir.mkdir(parents=True, exist_ok=True)
    if root.exists() and root.is_symlink():
        raise SkillPackageError("invalid skills root")
    if not root.exists():
        root.mkdir()
    root_res = root.resolve()
    return root, root_res


def _prepare_skill_id_dir(root: Path, root_res: Path, skill_id: str) -> Path:
    id_dir = root / skill_id
    if id_dir.exists():
        if id_dir.is_symlink():
            raise SkillPackageError("invalid skill install path")
        if not id_dir.is_dir():
            raise SkillPackageError("invalid skill install path")
    else:
        id_dir.mkdir()
    if not _inside_root(id_dir, root):
        raise SkillPackageError("invalid skill install path")
    if id_dir.resolve().parent != root_res:
        raise SkillPackageError("invalid skill install path")
    return id_dir


def _remove_confined_commit_dir(
    final: Path, root: Path, root_res: Path, skill_id: str, commit: str
) -> None:
    if not final.exists():
        return
    if final.is_symlink() or not final.is_dir():
        raise SkillPackageError("invalid skill install path")
    expected = root_res / skill_id / commit
    if final.resolve() != expected:
        raise SkillPackageError("invalid skill install path")
    _confined_rmtree(final)


def _copy_tree_no_git(src: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for dirpath, dirnames, filenames in os.walk(src, followlinks=False):
        current = Path(dirpath)
        rel = current.relative_to(src)
        dest_dir = dest / rel
        dest_dir.mkdir(parents=True, exist_ok=True)
        dirnames[:] = [name for name in dirnames if name != ".git"]
        for name in dirnames:
            entry = current / name
            if entry.is_symlink():
                raise SkillPackageError("directory symlinks are not allowed")
            (dest_dir / name).mkdir(exist_ok=True)
        for name in filenames:
            entry = current / name
            dest_entry = dest_dir / name
            if entry.is_symlink():
                target = entry.readlink()
                if target.is_absolute():
                    raise SkillPackageError("absolute symlinks are not allowed")
                if not _inside_root(dest_entry.parent / target, dest):
                    raise SkillPackageError("symlink escapes package root")
                dest_entry.symlink_to(target)
            else:
                dest_entry.write_bytes(entry.read_bytes())


def _confined_rmtree(path: Path) -> None:
    if not path.is_dir() or path.is_symlink():
        raise SkillPackageError("not a skill install directory")
    for entry in list(path.iterdir()):
        if entry.is_symlink():
            entry.unlink()
        elif entry.is_dir():
            _confined_rmtree(entry)
        else:
            entry.unlink()
    path.rmdir()


def _populate_clone(clone_root: Path, git_url: str, commit: str) -> None:
    _run_git(["clone", "--no-checkout", "--", git_url, str(clone_root)])
    obj_type = _run_git(["-C", str(clone_root), "cat-file", "-t", commit]).stdout.strip()
    if obj_type != "commit":
        raise SkillPackageError("pin is not a commit object")
    _run_git(["-C", str(clone_root), "checkout", "--detach", commit])
    head = _run_git(["-C", str(clone_root), "rev-parse", "HEAD"]).stdout.strip()
    if head != commit:
        raise SkillPackageError("checkout does not match pin")
    peeled = _run_git(
        ["-C", str(clone_root), "rev-parse", f"{commit}^{{commit}}"]
    ).stdout.strip()
    if peeled != commit:
        raise SkillPackageError("commit pin mismatch")


def install_skill(
    git_url: str,
    commit: str,
    *,
    subdir: str | None = None,
    data_home: Path | None = None,
    expected_id: str | None = None,
) -> InstalledSkill:
    commit = _validate_commit(commit)
    git_url = _validate_git_url(git_url)
    subdir_norm: str | None = None
    if subdir is not None:
        subdir_norm = _validate_subdir(subdir)

    with tempfile.TemporaryDirectory(prefix="arbor-skill-clone-") as tmp_name:
        clone_root = Path(tmp_name) / "repo"
        _populate_clone(clone_root, git_url, commit)

        if subdir_norm is None:
            package_root = clone_root
        else:
            package_root = safe_child(clone_root, subdir_norm)
            if package_root.is_symlink():
                raise SkillPackageError("package subdir must not be a symlink")
            if not package_root.is_dir():
                raise SkillPackageError("package subdir is not a directory")

        _reject_absolute_symlinks(package_root)
        manifest = inspect_package_tree(package_root)
        if expected_id is not None and manifest.id != expected_id:
            raise SkillPackageError("manifest id does not match expected id")

        root, root_res = _prepare_skills_root(data_home)
        id_dir = _prepare_skill_id_dir(root, root_res, manifest.id)
        final = id_dir / commit
        if not _inside_root(final, root):
            raise SkillPackageError("invalid skill install path")
        staging: Path | None = id_dir / f".install-{commit}-{uuid.uuid4().hex}"
        try:
            _copy_tree_no_git(package_root, staging)
            if not _inside_root(staging, root):
                raise SkillPackageError("invalid skill install path")
            meta = {
                "id": manifest.id,
                "commit": commit,
                "git": git_url,
                "subdir": subdir_norm,
            }
            (staging / "arbor-install.json").write_text(
                json.dumps(meta, separators=(",", ":")),
                encoding="utf-8",
            )
            inspect_package_tree(staging)
            _remove_confined_commit_dir(final, root, root_res, manifest.id, commit)
            os.replace(staging, final)
            staging = None
        except Exception:
            if staging is not None and staging.exists():
                if _inside_root(staging, root):
                    _confined_rmtree(staging)
            raise

        return InstalledSkill(
            id=manifest.id,
            commit=commit,
            path=final,
            manifest=manifest,
        )


def uninstall_skill(skill_id: str, *, data_home: Path | None = None) -> Path:
    skill_id = _validate_skill_id(skill_id)
    root = skills_root(data_home)
    id_dir = root / skill_id
    if not id_dir.exists():
        raise SkillPackageError(f"skill not installed: {skill_id}")
    if id_dir.is_symlink():
        raise SkillPackageError("invalid skill install path")
    if not id_dir.is_dir():
        raise SkillPackageError("invalid skill install path")
    root_res = root.resolve()
    if id_dir.resolve().parent != root_res:
        raise SkillPackageError("invalid skill install path")
    _confined_rmtree(id_dir)
    return id_dir


def cmd_skill_install(args) -> int:
    import sys

    from pathlib import Path as PathType

    data_home = PathType(args.data_home) if args.data_home else None
    try:
        installed = install_skill(
            args.git,
            args.commit,
            subdir=args.subdir,
            data_home=data_home,
            expected_id=args.id,
        )
    except SkillPackageError as error:
        print(str(error), file=sys.stderr)
        return 1
    payload = {
        "id": installed.id,
        "commit": installed.commit,
        "path": str(installed.path),
        "version": installed.manifest.version,
    }
    print(json.dumps(payload))
    return 0


def cmd_skill_uninstall(args) -> int:
    import sys

    from pathlib import Path as PathType

    data_home = PathType(args.data_home) if args.data_home else None
    try:
        uninstall_skill(args.id, data_home=data_home)
    except SkillPackageError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps({"id": args.id, "removed": True}))
    return 0

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Literal
from urllib.parse import unquote, urlparse

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from arbor_worker.skillpkg.manifest import PERMISSIONS, SkillPackageError

_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


class IndexPackage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    kind: Literal["skill", "provider"]
    name: str
    description: str
    git: str
    commit: str
    subdir: str | None = None
    permissions: list[str]

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID_RE.fullmatch(value):
            raise ValueError("invalid skill package id")
        return value

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not value or "\n" in value or "\x00" in value or len(value) > 120:
            raise ValueError("invalid name")
        return value

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str) -> str:
        if not value or "\n" in value or "\x00" in value or len(value) > 500:
            raise ValueError("invalid description")
        return value

    @field_validator("git")
    @classmethod
    def validate_git(cls, value: str) -> str:
        if not value or "\n" in value or "\x00" in value or value.startswith("-"):
            raise ValueError("invalid git URL")
        return value

    @field_validator("commit")
    @classmethod
    def validate_commit(cls, value: str) -> str:
        if not _COMMIT_RE.fullmatch(value):
            raise ValueError("commit must be a full lowercase 40-character git SHA")
        return value

    @field_validator("subdir")
    @classmethod
    def validate_subdir(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value or "\x00" in value or "\\" in value:
            raise ValueError("invalid subdir")
        if value.startswith("/") or (len(value) > 1 and value[1] == ":"):
            raise ValueError("invalid subdir")
        rel = Path(value)
        if rel.is_absolute():
            raise ValueError("invalid subdir")
        for part in rel.parts:
            if part in ("", ".", ".."):
                raise ValueError("invalid subdir")
        if ".." in rel.parts:
            raise ValueError("invalid subdir")
        return value

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("duplicate permission")
        for name in value:
            if name not in PERMISSIONS:
                raise ValueError(f"unknown permission: {name}")
        return value


class MarketplaceIndex(BaseModel):
    model_config = ConfigDict(extra="forbid")

    packages: list[IndexPackage]


def parse_index(data: object) -> MarketplaceIndex:
    if not isinstance(data, dict):
        raise SkillPackageError("index must be a JSON object")
    try:
        index = MarketplaceIndex.model_validate(data)
    except ValidationError as error:
        raise SkillPackageError(str(error)) from error
    ids = [pkg.id for pkg in index.packages]
    if len(ids) != len(set(ids)):
        raise SkillPackageError("duplicate package id")
    return index


def load_index_file(path: Path) -> MarketplaceIndex:
    if not path.is_file():
        raise SkillPackageError(f"index not found: {path}")
    if path.is_symlink():
        raise SkillPackageError("index must not be a symlink")
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as error:
        raise SkillPackageError(str(error)) from error
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise SkillPackageError(f"invalid index JSON: {error}") from error
    return parse_index(data)


def find_default_index(start: Path) -> Path | None:
    current = start.resolve()
    while True:
        candidate = current / "marketplace" / "index.json"
        if candidate.is_file() and not candidate.is_symlink():
            return candidate
        parent = current.parent
        if parent == current:
            return None
        current = parent


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


def _is_bare_repo(path: Path) -> bool:
    if not path.is_dir():
        return False
    if (path / ".git").exists():
        return False
    return (path / "HEAD").is_file() and (path / "objects").is_dir()


def _load_index_from_checkout_dir(source: Path) -> MarketplaceIndex:
    for candidate in (source / "index.json", source / "marketplace" / "index.json"):
        if candidate.is_file() and not candidate.is_symlink():
            return load_index_file(candidate)
    raise SkillPackageError("index not found")


def _read_index_at_repo_root(root: Path) -> MarketplaceIndex:
    for rel in ("marketplace/index.json", "index.json"):
        path = root / rel
        if path.is_file() and not path.is_symlink():
            return load_index_file(path)
    raise SkillPackageError("index not found")


def _fetch_index_from_git(git_url: str, ref: str) -> MarketplaceIndex:
    with tempfile.TemporaryDirectory(prefix="arbor-index-clone-") as tmp_name:
        clone_root = Path(tmp_name) / "repo"
        if _COMMIT_RE.fullmatch(ref):
            _run_git(["clone", "--no-checkout", "--", git_url, str(clone_root)])
            _run_git(["-C", str(clone_root), "checkout", "--detach", ref])
        elif ref == "HEAD":
            _run_git(["clone", "--no-checkout", "--", git_url, str(clone_root)])
            _run_git(["-C", str(clone_root), "checkout", "--detach", "HEAD"])
        else:
            _run_git(
                [
                    "clone",
                    "--no-checkout",
                    "--branch",
                    ref,
                    "--",
                    git_url,
                    str(clone_root),
                ]
            )
            _run_git(["-C", str(clone_root), "checkout", ref])
        return _read_index_at_repo_root(clone_root)


def fetch_index(source: str, *, ref: str | None = None) -> MarketplaceIndex:
    if source.startswith("file://"):
        parsed = urlparse(source)
        if parsed.scheme != "file":
            raise SkillPackageError("invalid git URL")
        git_path = unquote(parsed.path)
        checkout_ref = ref if ref else "HEAD"
        return _fetch_index_from_git(git_path, checkout_ref)

    path = Path(source)
    if path.is_file():
        return load_index_file(path)

    if path.is_dir():
        if ref:
            return _fetch_index_from_git(str(path.resolve()), ref)
        if _is_bare_repo(path):
            return _fetch_index_from_git(str(path.resolve()), "HEAD")
        return _load_index_from_checkout_dir(path)

    raise SkillPackageError(f"index not found: {source}")


def cmd_skill_index(args) -> int:
    import sys

    try:
        index = fetch_index(args.source, ref=args.ref)
    except SkillPackageError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(index.model_dump(mode="json"), separators=(",", ":")))
    return 0

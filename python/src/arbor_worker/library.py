from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from arbor_worker.gitstate import commit_batch, effective_git_email
from arbor_worker.sync import (
    _CREDENTIAL_URL_MSG,
    _remote_has_embedded_password,
    redact_git_text,
    set_remote,
    set_shared,
    sync_remote_name,
)

LIBRARY_REL = ".arbor/library.json"
_MAX_NAME_LEN = 80


class LibraryError(Exception):
    pass


def _library_path(root: Path) -> Path:
    return root / LIBRARY_REL


def _validate_library_doc(data: object) -> dict:
    if not isinstance(data, dict):
        raise LibraryError("Invalid library.json")
    name = data.get("name")
    created_by = data.get("created_by")
    members = data.get("members")
    if not isinstance(name, str) or not name.strip():
        raise LibraryError("Invalid library.json")
    if not isinstance(created_by, str) or not created_by.strip():
        raise LibraryError("Invalid library.json")
    if not isinstance(members, list) or not members:
        raise LibraryError("Invalid library.json")
    for member in members:
        if not isinstance(member, str) or not member.strip():
            raise LibraryError("Invalid library.json")
    return {
        "name": name.strip(),
        "created_by": created_by.strip(),
        "members": [m.strip() for m in members],
    }


def load_library(root: Path) -> dict | None:
    path = _library_path(root)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise LibraryError("Invalid library.json") from error
    return _validate_library_doc(data)


def is_shared_library(root: Path) -> bool:
    try:
        return load_library(root) is not None
    except LibraryError:
        return False


def create_shared_library(
    root: Path,
    name: str | None = None,
    runner=subprocess.run,
) -> dict:
    root = Path(root)
    if sync_remote_name(root, runner) is None:
        raise LibraryError(
            "Configure an Arbor remote for this folder before creating a shared library."
        )

    existing = _library_path(root)
    if existing.is_file():
        doc = load_library(root)
        set_shared(root, True)
        return doc

    if name is None:
        name = root.name
    else:
        name = name.strip()
    if not name:
        raise LibraryError("Library name must not be empty.")
    if len(name) > _MAX_NAME_LEN:
        raise LibraryError("Library name must be at most 80 characters.")

    email = effective_git_email(root, runner)
    doc = {"name": name, "members": [email], "created_by": email}
    path = _library_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    set_shared(root, True)
    commit_batch(root, [Path(LIBRARY_REL)], f"library: share {name}", runner=runner)
    return doc


def _dest_is_usable(dest: Path) -> tuple[bool, str | None]:
    if dest.is_symlink():
        return False, "Destination must not be a symlink."
    if dest.is_file():
        return False, "Destination must be a directory."
    if not dest.exists():
        return True, None
    try:
        entries = list(dest.iterdir())
    except OSError as error:
        return False, str(error)
    if entries:
        return False, "Destination is not empty."
    return True, None


def _cleanup_join_dest(dest: Path, created_dest: bool) -> None:
    if created_dest:
        if dest.exists():
            shutil.rmtree(dest)
        return
    if dest.is_dir() and not dest.is_symlink():
        for child in dest.iterdir():
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink(missing_ok=True)


def join_library(url: str, dest: Path, runner=subprocess.run) -> dict:
    url = (url or "").strip()
    if not url:
        raise LibraryError("URL must not be empty.")
    if url.startswith("-"):
        raise LibraryError("Invalid library URL.")
    if _remote_has_embedded_password(url):
        raise LibraryError(_CREDENTIAL_URL_MSG)

    dest = Path(dest)
    ok, reason = _dest_is_usable(dest)
    if not ok:
        raise LibraryError(reason or "Invalid destination.")

    created_dest = not dest.exists()
    if created_dest:
        dest.parent.mkdir(parents=True, exist_ok=True)

    clone = runner(
        ["git", "clone", "--", url, str(dest)],
        capture_output=True,
        text=True,
    )
    if clone.returncode != 0:
        _cleanup_join_dest(dest, created_dest)
        raise LibraryError(redact_git_text((clone.stderr or clone.stdout or "").strip()))

    try:
        set_remote(dest, url, runner=runner)
        doc = load_library(dest)
        if doc is None:
            raise LibraryError("Missing or invalid library.json")
    except LibraryError:
        _cleanup_join_dest(dest, created_dest)
        raise
    except Exception as error:
        from arbor_worker.sync import GitSyncError

        _cleanup_join_dest(dest, created_dest)
        if isinstance(error, GitSyncError):
            raise LibraryError(str(error)) from error
        raise

    set_shared(dest, True)
    return {
        "path": str(dest),
        "name": doc["name"],
        "kind": "shared",
        "created_by": doc["created_by"],
        "members": doc["members"],
    }

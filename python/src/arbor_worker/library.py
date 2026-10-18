from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

from arbor_worker.gitstate import (
    commit_batch,
    effective_git_email,
    path_has_pending_changes,
)
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
_VALID_ROLES = frozenset({"owner", "editor", "viewer"})
_PROVIDER_ID_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
_MAX_MODEL_LEN = 128

_VIEWER_WRITE_DENIED = (
    "Viewers cannot run write jobs or push. Your role on this library is viewer. "
    "An owner can change it in Settings → Library. "
    "Arbor's check is advisory; the git host's permissions are what actually enforce access."
)
VIEWER_WRITE_DENIED = _VIEWER_WRITE_DENIED

_ALLOWED_KEY_NORMALIZED = frozenset(
    {"name", "createdby", "members", "email", "role", "provider", "id", "model"}
)
_FORBIDDEN_KEY_FRAGMENTS = (
    "apikey",
    "token",
    "secret",
    "password",
    "passwd",
    "credential",
    "credentials",
    "authorization",
    "accesskey",
    "privatekey",
    "bearer",
    "key",
    "refreshtoken",
    "clientsecret",
    "authtoken",
)
_TOP_LEVEL_KEYS = frozenset({"name", "created_by", "members", "provider"})


class LibraryError(Exception):
    pass


def _library_path(root: Path) -> Path:
    return root / LIBRARY_REL


def _normalize_key_name(key: str) -> str:
    return key.casefold().replace("_", "").replace("-", "")


def _reject_credential_keys(data: object) -> None:
    if isinstance(data, dict):
        for key, value in data.items():
            norm = _normalize_key_name(key)
            if norm not in _ALLOWED_KEY_NORMALIZED:
                for fragment in _FORBIDDEN_KEY_FRAGMENTS:
                    if norm == fragment or fragment in norm:
                        raise LibraryError("library.json must not contain credentials")
            _reject_credential_keys(value)
    elif isinstance(data, list):
        for item in data:
            _reject_credential_keys(item)


def _validate_provider(provider: object) -> dict:
    if not isinstance(provider, dict):
        raise LibraryError("Invalid library.json")
    if set(provider.keys()) != {"id", "model"}:
        raise LibraryError("Invalid library.json")
    pid = provider.get("id")
    model = provider.get("model")
    if not isinstance(pid, str) or not pid.strip():
        raise LibraryError("Invalid library.json")
    if not isinstance(model, str) or not model.strip():
        raise LibraryError("Invalid library.json")
    pid = pid.strip()
    model = model.strip()
    if not _PROVIDER_ID_RE.match(pid):
        raise LibraryError("Invalid library.json")
    if len(model) > _MAX_MODEL_LEN or "\n" in model or "\r" in model:
        raise LibraryError("Invalid library.json")
    return {"id": pid, "model": model}


def _normalize_string_members(name: str, created_by: str, members: list[str]) -> list[dict]:
    stripped: list[str] = []
    seen: set[str] = set()
    for raw in members:
        if not isinstance(raw, str) or not raw.strip():
            raise LibraryError("Invalid library.json")
        email = raw.strip()
        folded = email.casefold()
        if folded in seen:
            raise LibraryError("Invalid library.json")
        seen.add(folded)
        stripped.append(email)

    if not stripped:
        raise LibraryError("Invalid library.json")

    created_fold = created_by.casefold()
    if created_fold not in seen:
        stripped.insert(0, created_by)

    result: list[dict] = []
    seen_result: set[str] = set()
    for email in stripped:
        folded = email.casefold()
        if folded in seen_result:
            raise LibraryError("Invalid library.json")
        seen_result.add(folded)
        role = "owner" if folded == created_fold else "editor"
        result.append({"email": email, "role": role})
    return result


def _validate_object_members(members: list) -> list[dict]:
    if not members:
        raise LibraryError("Invalid library.json")
    result: list[dict] = []
    seen: set[str] = set()
    owners = 0
    for member in members:
        if not isinstance(member, dict):
            raise LibraryError("Invalid library.json")
        email = member.get("email")
        role = member.get("role")
        if not isinstance(email, str) or not email.strip():
            raise LibraryError("Invalid library.json")
        if role not in _VALID_ROLES:
            raise LibraryError("Invalid library.json")
        email = email.strip()
        folded = email.casefold()
        if folded in seen:
            raise LibraryError("Invalid library.json")
        seen.add(folded)
        if role == "owner":
            owners += 1
        result.append({"email": email, "role": role})
    if owners < 1:
        raise LibraryError("Invalid library.json")
    return result


def _members_need_migration(members: list) -> bool:
    if not members:
        return False
    return isinstance(members[0], str)


def _validate_library_doc(data: object) -> dict:
    if not isinstance(data, dict):
        raise LibraryError("Invalid library.json")
    _reject_credential_keys(data)

    extra = set(data.keys()) - _TOP_LEVEL_KEYS
    if extra:
        raise LibraryError("Invalid library.json")

    name = data.get("name")
    created_by = data.get("created_by")
    members = data.get("members")
    if not isinstance(name, str) or not name.strip():
        raise LibraryError("Invalid library.json")
    if not isinstance(created_by, str) or not created_by.strip():
        raise LibraryError("Invalid library.json")
    if not isinstance(members, list):
        raise LibraryError("Invalid library.json")

    name = name.strip()
    created_by = created_by.strip()

    if _members_need_migration(members):
        normalized_members = _normalize_string_members(name, created_by, members)
    else:
        normalized_members = _validate_object_members(members)

    doc: dict = {
        "name": name,
        "created_by": created_by,
        "members": normalized_members,
    }
    if "provider" in data:
        doc["provider"] = _validate_provider(data["provider"])
    return doc


def _serialize_library_doc(doc: dict) -> str:
    payload: dict = {
        "name": doc["name"],
        "created_by": doc["created_by"],
        "members": doc["members"],
    }
    if "provider" in doc:
        payload["provider"] = doc["provider"]
    return json.dumps(payload, indent=2) + "\n"


def _write_library_doc(root: Path, doc: dict) -> None:
    path = _library_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_serialize_library_doc(doc), encoding="utf-8")


def load_library(root: Path) -> dict | None:
    path = _library_path(root)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise LibraryError("Invalid library.json") from error
    return _validate_library_doc(data)


def library_needs_member_migration(root: Path) -> bool:
    path = _library_path(root)
    if not path.is_file():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False
    if not isinstance(data, dict):
        return False
    members = data.get("members")
    if not isinstance(members, list) or not members:
        return False
    return _members_need_migration(members)


def is_shared_library(root: Path) -> bool:
    try:
        return load_library(root) is not None
    except LibraryError:
        return False


def current_role(root: Path, runner=subprocess.run) -> str | None:
    doc = load_library(root)
    if doc is None:
        return None
    email = effective_git_email(root, runner)
    folded = email.casefold()
    for member in doc["members"]:
        if member["email"].casefold() == folded:
            return member["role"]
    return "viewer"


def assert_can_write(root: Path, runner=subprocess.run) -> None:
    role = current_role(root, runner)
    if role is None:
        return
    if role == "viewer":
        raise LibraryError(VIEWER_WRITE_DENIED)


def assert_can_edit_members(root: Path, runner=subprocess.run) -> None:
    role = current_role(root, runner)
    if role is None:
        raise LibraryError("No shared library at this folder.")
    if role != "owner":
        raise LibraryError(
            "Only an owner can edit library members and roles. "
            "Arbor's check is advisory; the git host's permissions are what actually enforce access."
        )


def migrate_library_file(root: Path, runner=subprocess.run) -> dict:
    root = Path(root)
    path = _library_path(root)
    if not path.is_file():
        raise LibraryError("No shared library at this folder.")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise LibraryError("Invalid library.json") from error
    doc = _validate_library_doc(data)
    if _members_need_migration(data.get("members", [])):
        _write_library_doc(root, doc)
    return doc


def set_library_members(
    root: Path,
    members: list[dict],
    runner=subprocess.run,
) -> dict:
    root = Path(root)
    assert_can_edit_members(root, runner)
    existing = load_library(root)
    if existing is None:
        raise LibraryError("No shared library at this folder.")

    normalized = _validate_object_members(members)
    doc = {
        "name": existing["name"],
        "created_by": existing["created_by"],
        "members": normalized,
    }
    if "provider" in existing:
        doc["provider"] = existing["provider"]
    _write_library_doc(root, doc)
    if path_has_pending_changes(root, Path(LIBRARY_REL), runner=runner):
        commit_batch(root, [Path(LIBRARY_REL)], "library: update members", runner=runner)
    return load_library(root)  # type: ignore[return-value]


def set_library_provider(
    root: Path,
    provider: dict | None,
    runner=subprocess.run,
) -> dict:
    root = Path(root)
    existing = load_library(root)
    if existing is None:
        raise LibraryError("No shared library at this folder.")
    assert_can_write(root, runner)

    doc = {
        "name": existing["name"],
        "created_by": existing["created_by"],
        "members": existing["members"],
    }
    if provider is not None:
        doc["provider"] = _validate_provider(provider)
    _write_library_doc(root, doc)
    if path_has_pending_changes(root, Path(LIBRARY_REL), runner=runner):
        commit_batch(root, [Path(LIBRARY_REL)], "library: update provider", runner=runner)
    return load_library(root)  # type: ignore[return-value]


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
        return _public_doc(doc)

    if name is None:
        name = root.name
    else:
        name = name.strip()
    if not name:
        raise LibraryError("Library name must not be empty.")
    if len(name) > _MAX_NAME_LEN:
        raise LibraryError("Library name must be at most 80 characters.")

    email = effective_git_email(root, runner)
    doc = {
        "name": name,
        "created_by": email,
        "members": [{"email": email, "role": "owner"}],
    }
    _write_library_doc(root, doc)
    set_shared(root, True)
    commit_batch(root, [Path(LIBRARY_REL)], f"library: share {name}", runner=runner)
    return _public_doc(doc)


def _public_doc(doc: dict) -> dict:
    out = {
        "name": doc["name"],
        "created_by": doc["created_by"],
        "members": doc["members"],
    }
    if "provider" in doc:
        out["provider"] = doc["provider"]
    return out


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
    pub = _public_doc(doc)
    return {
        "path": str(dest),
        "name": pub["name"],
        "kind": "shared",
        "created_by": pub["created_by"],
        "members": pub["members"],
    }

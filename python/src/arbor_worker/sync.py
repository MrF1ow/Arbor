from __future__ import annotations

import fnmatch
import io
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from arbor_worker.gitstate import GitStateError, commit_and_note, git_identity_args
from arbor_worker.events import EventEmitter

if TYPE_CHECKING:
    from arbor_worker.events import EventEmitter as EventEmitterType

DERIVED_GITIGNORE_ENTRIES: tuple[str, ...] = (
    "_arbor_cache/",
    ".arbor/progress/",
    ".arbor/*.db",
    ".arbor/*.db-*",
    ".arbor/vectors.sqlite",
    ".arbor/vectors.sqlite-*",
    ".arbor/chat/",
    ".arbor/sync-conflict.json",
)

BINARY_SUFFIXES = frozenset(
    {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".db", ".sqlite", ".zip", ".pptx", ".docx"}
)

REMOTE_NAME = "arbor"
SYNC_CONFIG = ".arbor/sync.json"
CONFLICT_SESSION = ".arbor/sync-conflict.json"

_CREDENTIAL_URL_MSG = (
    "Refusing a remote URL with an embedded password. Arbor does not store credentials."
)

_REDACT_PASSWORD = re.compile(
    r"([a-zA-Z][a-zA-Z0-9+.-]*://[^:/@\s]+):([^@\s/]+)@"
)


class GitSyncError(Exception):
    pass


class SyncConflictError(Exception):
    pass


@dataclass(frozen=True)
class SyncReport:
    ok: bool
    action: str
    commit: str | None = None
    files: list[str] | None = None


def redact_git_text(text: str) -> str:
    return _REDACT_PASSWORD.sub(r"\1:***@", text)


def derived_gitignore_extras(cache_dir_name: str = "_arbor_cache") -> list[str]:
    cache_entry = f"{cache_dir_name}/"
    return [e for e in DERIVED_GITIGNORE_ENTRIES if e != cache_entry]


def _git(
    root: Path,
    args: list[str],
    *,
    runner=subprocess.run,
    identity: bool = False,
    check: bool = False,
) -> subprocess.CompletedProcess[str]:
    prefix: list[str] = ["git", "-C", str(root)]
    if identity:
        prefix.extend(git_identity_args(root, runner))
    proc = runner([*prefix, *args], capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise GitSyncError(redact_git_text((proc.stderr or proc.stdout or "").strip()))
    return proc


def _remote_has_embedded_password(url: str) -> bool:
    if url.startswith("git@"):
        return False
    parsed = urlparse(url)
    return bool(parsed.password)


def set_remote(root: Path, url: str, runner=subprocess.run) -> None:
    if _remote_has_embedded_password(url):
        raise GitSyncError(_CREDENTIAL_URL_MSG)
    proc = _git(root, ["remote"], runner=runner)
    if proc.returncode != 0:
        raise GitSyncError(redact_git_text((proc.stderr or "").strip()))
    remotes = (proc.stdout or "").splitlines()
    if REMOTE_NAME in remotes:
        proc = _git(root, ["remote", "set-url", REMOTE_NAME, url], runner=runner)
    else:
        proc = _git(root, ["remote", "add", REMOTE_NAME, url], runner=runner)
    if proc.returncode != 0:
        raise GitSyncError(redact_git_text((proc.stderr or "").strip()))


def remote_url(root: Path, runner=subprocess.run) -> str | None:
    proc = _git(root, ["remote", "get-url", REMOTE_NAME], runner=runner)
    if proc.returncode != 0:
        return None
    url = (proc.stdout or "").strip()
    return url if url else None


def _read_shared(root: Path) -> bool:
    path = root / SYNC_CONFIG
    if not path.is_file():
        return False
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        return False
    return bool(data.get("shared")) if isinstance(data, dict) else False


def set_shared(root: Path, shared: bool) -> None:
    path = root / SYNC_CONFIG
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"shared": shared}, indent=2) + "\n")


def _is_derived_tracked(rel: str) -> bool:
    if rel.startswith("_arbor_cache/"):
        return True
    if rel.startswith(".arbor/chat/"):
        return True
    if rel.startswith(".arbor/progress/"):
        return True
    for pattern in (
        ".arbor/*.db",
        ".arbor/*.db-*",
        ".arbor/vectors.sqlite",
        ".arbor/vectors.sqlite-*",
    ):
        if fnmatch.fnmatch(rel, pattern):
            return True
    return False


def _append_gitignore_entries(root: Path) -> bool:
    gi = root / ".gitignore"
    existing = gi.read_text().splitlines() if gi.is_file() else []
    missing = [e for e in DERIVED_GITIGNORE_ENTRIES if e not in existing]
    if not missing:
        return False
    with open(gi, "a") as fh:
        if existing and existing[-1].strip() != "":
            fh.write("\n")
        fh.write("\n".join(missing) + "\n")
    return True


def migrate_derived_files(
    root: Path,
    runner=subprocess.run,
    emitter: EventEmitterType | None = None,
) -> None:
    root = Path(root)
    gi_changed = _append_gitignore_entries(root)
    status = _git(root, ["status", "--porcelain", "--", ".gitignore"], runner=runner)
    if (status.stdout or "").strip():
        gi_changed = True
    proc = _git(root, ["ls-files"], runner=runner)
    if proc.returncode != 0:
        raise GitSyncError(redact_git_text((proc.stderr or "").strip()))
    to_untrack = [p for p in (proc.stdout or "").splitlines() if _is_derived_tracked(p)]
    index_changed = False
    if to_untrack:
        rm = _git(
            root,
            ["rm", "-r", "--cached", "--ignore-unmatch", "--", *to_untrack],
            runner=runner,
        )
        if rm.returncode != 0:
            raise GitSyncError(redact_git_text((rm.stderr or "").strip()))
        index_changed = True
    if not gi_changed and not index_changed:
        return
    rel_paths: list[Path] = []
    if gi_changed:
        rel_paths.append(Path(".gitignore"))
    out = emitter or EventEmitter(io.StringIO())
    if rel_paths:
        commit_and_note(
            root,
            rel_paths,
            "chore: ignore derived Arbor files",
            out,
            runner=runner,
        )
    else:
        identity = git_identity_args(root, runner)
        commit = runner(
            [
                "git",
                "-C",
                str(root),
                *identity,
                "commit",
                "-m",
                "chore: ignore derived Arbor files",
            ],
            capture_output=True,
            text=True,
        )
        if commit.returncode != 0:
            raise GitSyncError(redact_git_text((commit.stderr or "").strip()))


def _rebase_in_progress(root: Path, runner=subprocess.run) -> bool:
    return (root / ".git" / "rebase-merge").is_dir() or (
        root / ".git" / "rebase-apply"
    ).is_dir()


def _merge_in_progress(root: Path) -> bool:
    return (root / ".git" / "MERGE_HEAD").is_file()


def _abort_integration(root: Path, strategy: str, runner=subprocess.run) -> None:
    if strategy == "rebase" and _rebase_in_progress(root, runner):
        _git(root, ["rebase", "--abort"], runner=runner)
    elif strategy == "merge" and _merge_in_progress(root):
        _git(root, ["merge", "--abort"], runner=runner)


def _abort_any_in_progress(root: Path, runner=subprocess.run) -> None:
    if _rebase_in_progress(root, runner):
        _git(root, ["rebase", "--abort"], runner=runner)
    if _merge_in_progress(root):
        _git(root, ["merge", "--abort"], runner=runner)


def _current_branch(root: Path, runner=subprocess.run) -> str:
    proc = _git(root, ["symbolic-ref", "--short", "HEAD"], runner=runner)
    if proc.returncode != 0:
        raise GitSyncError(redact_git_text((proc.stderr or "").strip()))
    return (proc.stdout or "").strip()


def _short_head(root: Path, runner=subprocess.run) -> str:
    proc = _git(root, ["rev-parse", "--short", "HEAD"], runner=runner)
    if proc.returncode != 0:
        raise GitSyncError(redact_git_text((proc.stderr or "").strip()))
    return (proc.stdout or "").strip()


def _ref_exists(root: Path, ref: str, runner=subprocess.run) -> bool:
    proc = _git(root, ["rev-parse", "--verify", ref], runner=runner)
    return proc.returncode == 0


def _rev_list_count(root: Path, range_spec: str, runner=subprocess.run) -> int:
    proc = _git(root, ["rev-list", "--count", range_spec], runner=runner)
    if proc.returncode != 0:
        return 0
    return int((proc.stdout or "0").strip() or "0")


def _unmerged_paths(root: Path, runner=subprocess.run) -> list[str]:
    proc = _git(
        root,
        ["diff", "--name-only", "--diff-filter=U"],
        runner=runner,
    )
    if proc.returncode != 0:
        return []
    return [p for p in (proc.stdout or "").splitlines() if p.strip()]


def _stage_bytes(root: Path, path: str, stage: int, runner=subprocess.run) -> bytes | None:
    proc = runner(
        ["git", "-C", str(root), "show", f":{stage}:{path}"],
        capture_output=True,
    )
    if proc.returncode != 0:
        return None
    return proc.stdout


def _is_binary_path(path: str, mine: bytes | None, theirs: bytes | None) -> bool:
    suffix = PurePosixPath(path).suffix.lower()
    if suffix in BINARY_SUFFIXES:
        return True
    for blob in (mine, theirs):
        if blob is not None and b"\x00" in blob:
            return True
    return False


def _side_labels(strategy: str) -> tuple[str, str]:
    if strategy == "rebase":
        return ("theirs", "mine")
    return ("mine", "theirs")


def _capture_conflict_session(
    root: Path,
    *,
    strategy: str,
    upstream_ref: str,
    branch: str,
    paths: list[str],
    runner=subprocess.run,
    prior: dict | None = None,
) -> dict:
    stage_mine, stage_theirs = (2, 3) if strategy == "merge" else (3, 2)
    files: list[dict] = []
    prior_by_path = {}
    if prior:
        for entry in prior.get("files") or []:
            if isinstance(entry, dict) and entry.get("path"):
                prior_by_path[entry["path"]] = entry
    for path in paths:
        mine_b = _stage_bytes(root, path, stage_mine, runner)
        theirs_b = _stage_bytes(root, path, stage_theirs, runner)
        binary = _is_binary_path(path, mine_b, theirs_b)
        entry: dict = {"path": path, "binary": binary}
        if not binary:
            entry["mine"] = mine_b.decode("utf-8") if mine_b is not None else None
            entry["theirs"] = theirs_b.decode("utf-8") if theirs_b is not None else None
        old = prior_by_path.get(path)
        if old and old.get("choice"):
            entry["choice"] = old["choice"]
            if old.get("choice") == "edit" and "edit_content" in old:
                entry["edit_content"] = old["edit_content"]
        files.append(entry)
    return {
        "strategy": strategy,
        "upstream": upstream_ref,
        "branch": branch,
        "files": files,
    }


def _write_conflict_session(root: Path, session: dict) -> None:
    path = root / CONFLICT_SESSION
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(session, indent=2) + "\n")


def _load_conflict_session(root: Path) -> dict | None:
    path = root / CONFLICT_SESSION
    if not path.is_file():
        return None
    return json.loads(path.read_text())


def _clear_conflict_session(root: Path) -> None:
    path = root / CONFLICT_SESSION
    if path.is_file():
        path.unlink()


def _rebuild_after_sync(root: Path) -> None:
    from arbor_worker.embed import embed_root
    from arbor_worker.embedder.hashed import HashedNgramEmbedder
    from arbor_worker.indexer import reindex_root

    reindex_root(root)
    vectors = root / ".arbor" / "vectors.sqlite"
    if vectors.is_file():
        embed_root(root, HashedNgramEmbedder())


def sync_root(root: Path, runner=subprocess.run) -> SyncReport:
    root = Path(root)
    if remote_url(root, runner) is None:
        raise GitSyncError("No arbor remote is configured for this Knowledge root.")

    migrate_derived_files(root, runner=runner)
    pre_fetch_head_proc = _git(root, ["rev-parse", "HEAD"], runner=runner)
    pre_fetch_head = (pre_fetch_head_proc.stdout or "").strip()

    fetch = _git(root, ["fetch", REMOTE_NAME], runner=runner)
    if fetch.returncode != 0:
        raise GitSyncError(redact_git_text((fetch.stderr or "").strip()))

    branch = _current_branch(root, runner)
    upstream_ref = f"{REMOTE_NAME}/{branch}"

    if not _ref_exists(root, upstream_ref, runner):
        push = _git(root, ["push", "-u", REMOTE_NAME, "HEAD"], runner=runner)
        if push.returncode != 0:
            raise GitSyncError(redact_git_text((push.stderr or "").strip()))
        return SyncReport(ok=True, action="pushed", commit=_short_head(root, runner))

    behind = _rev_list_count(root, f"HEAD..{upstream_ref}", runner)
    ahead = _rev_list_count(root, f"{upstream_ref}..HEAD", runner)

    if behind == 0:
        if ahead == 0:
            return SyncReport(ok=True, action="up_to_date", commit=_short_head(root, runner))
        push = _git(root, ["push", REMOTE_NAME, "HEAD"], runner=runner)
        if push.returncode != 0:
            raise GitSyncError(redact_git_text((push.stderr or "").strip()))
        return SyncReport(ok=True, action="pushed", commit=_short_head(root, runner))

    strategy = "merge" if _read_shared(root) else "rebase"
    try:
        if strategy == "merge":
            merge = _git(
                root,
                ["merge", upstream_ref, "-m", f"sync: merge {upstream_ref}"],
                runner=runner,
                identity=True,
            )
            if merge.returncode != 0:
                paths = _unmerged_paths(root, runner)
                if paths:
                    session = _capture_conflict_session(
                        root,
                        strategy=strategy,
                        upstream_ref=upstream_ref,
                        branch=branch,
                        paths=paths,
                        runner=runner,
                    )
                    _write_conflict_session(root, session)
                    _abort_integration(root, strategy, runner)
                    return SyncReport(
                        ok=False,
                        action="conflict",
                        files=paths,
                    )
                _abort_integration(root, strategy, runner)
                raise GitSyncError(redact_git_text((merge.stderr or "").strip()))
        else:
            rebase = _git(
                root,
                ["rebase", upstream_ref],
                runner=runner,
                identity=True,
            )
            if rebase.returncode != 0:
                paths = _unmerged_paths(root, runner)
                if paths:
                    session = _capture_conflict_session(
                        root,
                        strategy=strategy,
                        upstream_ref=upstream_ref,
                        branch=branch,
                        paths=paths,
                        runner=runner,
                    )
                    _write_conflict_session(root, session)
                    _abort_integration(root, strategy, runner)
                    return SyncReport(
                        ok=False,
                        action="conflict",
                        files=paths,
                    )
                _abort_integration(root, strategy, runner)
                raise GitSyncError(redact_git_text((rebase.stderr or "").strip()))
    finally:
        if _rebase_in_progress(root, runner) or _merge_in_progress(root):
            _abort_any_in_progress(root, runner)
            raise GitSyncError("Sync left an incomplete rebase or merge; aborted.")

    push = _git(root, ["push", REMOTE_NAME, "HEAD"], runner=runner)
    if push.returncode != 0:
        raise GitSyncError(redact_git_text((push.stderr or "").strip()))

    post_head_proc = _git(root, ["rev-parse", "HEAD"], runner=runner)
    post_head = (post_head_proc.stdout or "").strip()
    if post_head != pre_fetch_head:
        _rebuild_after_sync(root)

    return SyncReport(ok=True, action="integrated", commit=_short_head(root, runner))


def resolve_conflict(
    root: Path,
    path: str,
    side: str,
    content: str | None = None,
) -> None:
    session = _load_conflict_session(root)
    if not session:
        raise SyncConflictError("No sync conflict session is open.")
    files = session.get("files") or []
    entry = next((f for f in files if f.get("path") == path), None)
    if entry is None:
        raise SyncConflictError(f"Unknown conflict path: {path}")
    if entry.get("binary"):
        raise SyncConflictError(f"Arbor does not resolve binary conflicts: {path}")
    if side not in ("mine", "theirs", "edit"):
        raise SyncConflictError(f"Invalid side: {side}")
    if side == "edit":
        if content is None:
            raise SyncConflictError("--content is required for side edit")
        entry["choice"] = "edit"
        entry["edit_content"] = content
    else:
        entry["choice"] = side
        entry.pop("edit_content", None)
    _write_conflict_session(root, session)


def _apply_file_choice(
    root: Path,
    entry: dict,
    runner=subprocess.run,
) -> None:
    path = entry["path"]
    choice = entry.get("choice")
    if not choice:
        raise SyncConflictError(f"No resolution for {path}")
    if entry.get("binary"):
        raise SyncConflictError(f"Arbor does not resolve binary conflicts: {path}")
    target = root / path
    if choice == "edit":
        text = entry.get("edit_content")
        if text is None:
            raise SyncConflictError(f"No edit content for {path}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    elif choice == "mine":
        text = entry.get("mine")
        if text is None:
            raise SyncConflictError(f"Missing mine side for {path}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    elif choice == "theirs":
        text = entry.get("theirs")
        if text is None:
            raise SyncConflictError(f"Missing theirs side for {path}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    else:
        raise SyncConflictError(f"Invalid choice for {path}")
    add = _git(root, ["add", "--", path], runner=runner)
    if add.returncode != 0:
        raise GitSyncError(redact_git_text((add.stderr or "").strip()))


def _continue_rebase_or_merge(root: Path, strategy: str, runner=subprocess.run) -> None:
    if strategy == "rebase":
        cont = _git(
            root,
            ["-c", "core.editor=true", "rebase", "--continue"],
            runner=runner,
            identity=True,
        )
        if cont.returncode != 0:
            raise GitSyncError(redact_git_text((cont.stderr or "").strip()))
    else:
        commit = _git(
            root,
            ["commit", "--no-edit"],
            runner=runner,
            identity=True,
        )
        if commit.returncode != 0:
            raise GitSyncError(redact_git_text((commit.stderr or "").strip()))


def continue_sync(root: Path, runner=subprocess.run) -> SyncReport:
    root = Path(root)
    session = _load_conflict_session(root)
    if not session:
        raise GitSyncError("No sync conflict session is open.")

    files = session.get("files") or []
    for entry in files:
        if entry.get("binary"):
            raise SyncConflictError(
                f"Arbor does not resolve binary conflicts: {entry['path']}"
            )
        if not entry.get("choice"):
            raise SyncConflictError(f"No resolution for {entry['path']}")

    strategy = session.get("strategy", "rebase")
    upstream_ref = session["upstream"]
    branch = session.get("branch") or _current_branch(root, runner)
    pre_continue_head_proc = _git(root, ["rev-parse", "HEAD"], runner=runner)
    pre_continue_head = (pre_continue_head_proc.stdout or "").strip()

    try:
        if strategy == "merge":
            merge = _git(
                root,
                ["merge", upstream_ref, "-m", f"sync: merge {upstream_ref}"],
                runner=runner,
                identity=True,
            )
            if merge.returncode != 0 and not _unmerged_paths(root, runner):
                raise GitSyncError(redact_git_text((merge.stderr or "").strip()))
        else:
            rebase = _git(
                root,
                ["rebase", upstream_ref],
                runner=runner,
                identity=True,
            )
            if rebase.returncode != 0 and not _unmerged_paths(root, runner):
                raise GitSyncError(redact_git_text((rebase.stderr or "").strip()))

        while _rebase_in_progress(root, runner) or _merge_in_progress(root):
            paths = _unmerged_paths(root, runner)
            if paths:
                by_path = {f["path"]: f for f in files}
                for path in paths:
                    entry = by_path.get(path)
                    if entry is None or not entry.get("choice"):
                        new_session = _capture_conflict_session(
                            root,
                            strategy=strategy,
                            upstream_ref=upstream_ref,
                            branch=branch,
                            paths=paths,
                            runner=runner,
                            prior=session,
                        )
                        _write_conflict_session(root, new_session)
                        _abort_integration(root, strategy, runner)
                        return SyncReport(ok=False, action="conflict", files=paths)
                    _apply_file_choice(root, entry, runner)
            _continue_rebase_or_merge(root, strategy, runner)

    finally:
        if _rebase_in_progress(root, runner) or _merge_in_progress(root):
            _abort_any_in_progress(root, runner)
            raise GitSyncError("Sync left an incomplete rebase or merge; aborted.")

    push = _git(root, ["push", REMOTE_NAME, "HEAD"], runner=runner)
    if push.returncode != 0:
        raise GitSyncError(redact_git_text((push.stderr or "").strip()))

    post_head_proc = _git(root, ["rev-parse", "HEAD"], runner=runner)
    post_head = (post_head_proc.stdout or "").strip()
    if post_head != pre_continue_head:
        _rebuild_after_sync(root)

    _clear_conflict_session(root)
    return SyncReport(ok=True, action="integrated", commit=_short_head(root, runner))


def maybe_sync_after_commit(root: Path, emitter: EventEmitterType) -> None:
    from arbor_worker.settings import load_settings

    settings = load_settings(root)
    if not settings.sync_after_commit:
        return
    if remote_url(root) is None:
        return
    try:
        report = sync_root(root)
    except GitSyncError as error:
        emitter.error(message=str(error))
        return
    except GitStateError as error:
        emitter.error(message=str(error))
        return
    if not report.ok and report.action == "conflict" and report.files:
        names = ", ".join(report.files)
        emitter.emit(
            "sync_conflict",
            files=report.files,
            message=f"Sync conflict in: {names}",
        )

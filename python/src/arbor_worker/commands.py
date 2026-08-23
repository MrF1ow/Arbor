from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from arbor_worker.alignment import PageRange
from arbor_worker.auth import check_codex_auth
from arbor_worker.cache import ensure_gitignored
from arbor_worker.events import EventEmitter
from arbor_worker.gitstate import GitStateError, commit_batch
from arbor_worker.provider.base import ProviderRequest
from arbor_worker.provider.codex import CodexCliProvider
from arbor_worker.provider.fake import FakeProvider
from arbor_worker.settings import default_settings, load_models, load_settings
from arbor_worker.skills import SKILLS
from arbor_worker.skills.base import run_skill
from arbor_worker.skills.manifest import (
    ManifestArtifact,
    load_manifest,
    write_manifest,
)

_DEFAULT_FAKE_MD = (
    "# Lecture\n## Overview\nThis is a fake digest overview long enough to validate.\n"
    "## Key Concepts\n- concept\n## Important Details\n- detail\n"
    "## Questions to Review\n- question?\n"
)


def cmd_check_auth(args) -> int:
    settings = default_settings()
    res = check_codex_auth()
    print(json.dumps({
        "authenticated": res.ok,
        "reason": res.reason,
        "docs_url": settings.docs_url,
    }))
    return 0 if res.ok else 1


def cmd_list_models(args) -> int:
    root = Path(getattr(args, "root", None) or ".")
    models = load_models(root)
    print(json.dumps({"models": [{"id": m.id, "label": m.label} for m in models]}))
    return 0


def _load_selections(plan_path: str | None) -> dict[str, list[PageRange] | None]:
    if not plan_path:
        return {}
    data = json.loads(Path(plan_path).read_text())
    selections: dict[str, list[PageRange] | None] = {}
    for item in data.get("selections", []):
        if "ranges" not in item or item["ranges"] is None:
            selections[item["path"]] = None
            continue
        selections[item["path"]] = [_parse_range(pair) for pair in item["ranges"]]
    return selections


def _parse_range(raw) -> PageRange:
    if not isinstance(raw, (list, tuple)) or len(raw) != 2:
        raise ValueError(f"range must be [start, end], got {raw!r}")
    return PageRange(int(raw[0]), int(raw[1]))


def cmd_plan_update(args) -> int:
    from arbor_worker.planning import build_plan, plan_to_dict

    root = Path(args.root)
    settings = load_settings(root)
    print(json.dumps(plan_to_dict(build_plan(root, settings))))
    return 0


def cmd_update(args) -> int:
    from arbor_worker.pipeline import run_update

    root = Path(args.root)
    settings = load_settings(root)
    emitter = EventEmitter(sys.stdout)

    if args.provider == "codex":
        auth = check_codex_auth()
        if not auth.ok:
            emitter.auth_failed(reason=auth.reason, docs_url=settings.docs_url)
            return 3
        provider = CodexCliProvider(models=load_models(root))
    else:
        provider = FakeProvider(markdown=os.environ.get("ARBOR_FAKE_MD", _DEFAULT_FAKE_MD))

    cancel_file = Path(args.cancel_file) if args.cancel_file else None
    try:
        result = run_update(
            root,
            args.model,
            provider,
            emitter,
            settings,
            selections=_load_selections(getattr(args, "plan", None)),
            cancel_file=cancel_file,
        )
    except Exception as e:
        emitter.error(message=str(e))
        emitter.run_done(processed=0, failed=0, skipped=0)
        return 1
    return 0 if result.failed == 0 else 1


def cmd_generate(args) -> int:
    root = Path(args.root)
    course_dir = root / args.course
    emitter = EventEmitter(sys.stdout)
    settings = load_settings(root)
    skill = SKILLS.get(args.skill)

    if not course_dir.is_dir():
        emitter.skill_failed(
            course=args.course,
            skill=args.skill,
            message=f"course directory does not exist: {course_dir}",
        )
        return 1
    if skill is None:
        emitter.skill_failed(
            course=args.course,
            skill=args.skill,
            message=f"unknown study skill: {args.skill}",
        )
        return 1

    digest_paths = sorted((course_dir / "digests").glob("*.md"))
    if not digest_paths:
        emitter.skill_failed(
            course=args.course,
            skill=args.skill,
            message="course has no digests",
        )
        return 1

    source_hash = hashlib.sha256()
    digest_sections = []
    try:
        for digest_path in digest_paths:
            source_bytes = digest_path.read_bytes()
            source_hash.update(source_bytes)
            digest_sections.append(
                f"# {digest_path.name}\n\n{source_bytes.decode('utf-8')}"
            )
    except (OSError, UnicodeError) as error:
        emitter.skill_failed(
            course=args.course,
            skill=args.skill,
            message=str(error),
        )
        return 1
    content_sha256 = source_hash.hexdigest()
    digest_text = "\n\n".join(digest_sections)

    study_dir = course_dir / "study"
    manifest_path = study_dir / "manifest.json"
    artifact_path = study_dir / f"{skill.name}.json"
    try:
        manifest = load_manifest(manifest_path)
    except ValueError as error:
        emitter.skill_failed(
            course=args.course,
            skill=skill.name,
            message=str(error),
        )
        return 1

    current = manifest.artifacts.get(skill.name)
    if (
        not args.force
        and current is not None
        and current.content_sha256 == content_sha256
    ):
        emitter.skill_stale_skipped(
            course=args.course,
            skill=skill.name,
            content_sha256=content_sha256,
        )
        return 0

    if args.provider == "codex":
        if not args.model:
            emitter.skill_failed(
                course=args.course,
                skill=skill.name,
                message="--model is required with the codex provider",
            )
            return 2
        auth = check_codex_auth()
        if not auth.ok:
            emitter.auth_failed(
                reason=auth.reason,
                docs_url=settings.docs_url,
            )
            return 3
        provider = CodexCliProvider(models=load_models(root))
        model_id = args.model
    else:
        fake_markdown = os.environ.get(
            "ARBOR_FAKE_MD",
            json.dumps(
                {
                    "skill": skill.name,
                    "course": args.course,
                    "ok": True,
                }
            ),
        )
        provider = FakeProvider(markdown=fake_markdown)
        model_id = args.model or "fake-model"

    emitter.skill_started(course=args.course, skill=skill.name)
    request = ProviderRequest(
        prompt=skill.build_prompt(
            course=args.course,
            digest_text=digest_text,
        ),
        model_id=model_id,
        cwd=root,
    )

    def emit_retry(attempt: int, error: Exception) -> None:
        emitter.skill_progress(
            course=args.course,
            skill=skill.name,
            attempt=attempt,
            attempts=3,
            message=str(error),
        )

    try:
        artifact = run_skill(
            provider,
            request,
            skill,
            on_retry=emit_retry,
        )
    except Exception as error:
        emitter.skill_failed(
            course=args.course,
            skill=skill.name,
            message=str(error),
        )
        return 1

    study_dir.mkdir(parents=True, exist_ok=True)
    artifact_path.write_text(
        json.dumps(artifact.model_dump(mode="json"), indent=2) + "\n"
    )
    manifest.artifacts[skill.name] = ManifestArtifact(
        file=artifact_path.name,
        content_sha256=content_sha256,
        generated_at=datetime.now(timezone.utc),
    )
    write_manifest(manifest_path, manifest)
    ensure_gitignored(
        root,
        settings.cache_dir_name,
        [".arbor/progress/", ".arbor/vectors.sqlite"],
    )

    artifact_rel = artifact_path.relative_to(root)
    manifest_rel = manifest_path.relative_to(root)
    try:
        commit = commit_batch(
            root,
            [manifest_rel, artifact_rel],
            f"study: {args.course} {skill.name}",
        )
    except GitStateError as error:
        emitter.skill_failed(
            course=args.course,
            skill=skill.name,
            message=str(error),
        )
        return 1

    emitter.skill_done(
        course=args.course,
        skill=skill.name,
        file=str(artifact_rel),
    )
    emitter.committed(
        commit=commit,
        courses=[args.course],
        skill=skill.name,
    )
    return 0


def cmd_reindex(args) -> int:
    from arbor_worker.indexer import reindex_root

    totals = reindex_root(Path(args.root))
    print(json.dumps({"indexed_courses": totals, "documents": sum(totals.values())}))
    return 0

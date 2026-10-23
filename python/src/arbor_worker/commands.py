from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from arbor_worker.alignment import PageRange
from arbor_worker.auth import AuthResult, check_codex_auth
from arbor_worker.cache import ensure_gitignored
from arbor_worker.events import EventEmitter
from arbor_worker.gitstate import GitStateError, commit_and_note, path_has_pending_changes
from arbor_worker.provider.base import ProviderRequest
from arbor_worker.provider.fake import FakeProvider
from arbor_worker.provider.registry import PROVIDERS, PROVIDER_ORDER, make_provider
from arbor_worker.settings import default_settings, load_models, load_settings
from arbor_worker.skills import SKILLS
from arbor_worker.skills.base import run_skill
from arbor_worker.skills.citations import CitationsSkill
from arbor_worker.skills.concepts import ConceptsSkill, merge_graphs
from arbor_worker.skills.diagrams import DiagramsSkill, cached_page_images, merge_figures
from arbor_worker.schemas.study.concepts import ConceptGraph
from arbor_worker.skills.flashcards import FlashcardsSkill, digest_batches, merge_decks
from arbor_worker.skills.quiz import QuizSkill, merge_packs
from arbor_worker.skills.manifest import (
    ManifestArtifact,
    load_manifest,
    write_manifest,
)

def cmd_check_auth(args) -> int:
    provider_id = getattr(args, "provider", "codex") or "codex"
    entry = PROVIDERS[provider_id]
    if provider_id == "codex":
        try:
            res = check_codex_auth()
        except Exception as exc:
            res = AuthResult(False, str(exc) or "Codex CLI check failed")
        docs_url = entry.docs_url
    elif provider_id == "fake":
        res = AuthResult(True, "")
        docs_url = entry.docs_url
    else:
        root = Path(".")
        provider = make_provider(provider_id, root)
        status = provider.status()
        res = AuthResult(status.available, status.reason)
        docs_url = entry.docs_url
    print(json.dumps({
        "authenticated": res.ok,
        "reason": res.reason,
        "docs_url": docs_url,
    }))
    return 0 if res.ok else 1


def _models_json_override(root: Path, provider_id: str) -> bool:
    cfg = root / ".arbor" / "models.json"
    if not cfg.is_file():
        return False
    data = json.loads(cfg.read_text())
    providers_map = data.get("providers")
    if isinstance(providers_map, dict) and provider_id in providers_map:
        return True
    if provider_id == "codex" and "models" in data:
        return True
    return False


def _models_for_listing(root: Path, provider_id: str, provider) -> list:
    if provider_id in ("ollama", "lmstudio") and not _models_json_override(
        root, provider_id
    ):
        return provider.list_models()
    return load_models(root, provider_id)


def cmd_list_models(args) -> int:
    root = Path(getattr(args, "root", None) or ".")
    provider_id = getattr(args, "provider", "codex") or "codex"
    provider = make_provider(provider_id, root)
    models = _models_for_listing(root, provider_id, provider)
    print(json.dumps({"models": [{"id": m.id, "label": m.label} for m in models]}))
    return 0


def cmd_list_providers(args) -> int:
    root = Path(getattr(args, "root", None) or ".")
    payload = []
    for provider_id in PROVIDER_ORDER:
        entry = PROVIDERS[provider_id]
        provider = make_provider(provider_id, root)
        status = provider.status()
        models = _models_for_listing(root, provider_id, provider)
        payload.append(
            {
                "id": provider_id,
                "label": entry.label,
                "available": status.available,
                "reason": status.reason,
                "docs_url": entry.docs_url,
                "models": [{"id": m.id, "label": m.label} for m in models],
            }
        )
    print(json.dumps(payload))
    return 0


def _resolve_llm_provider(
    provider_id: str,
    root: Path,
    model_id: str | None,
    emitter: EventEmitter,
    *,
    fake_markdown: str | None = None,
    emit_missing_model_error: bool = True,
):
    entry = PROVIDERS[provider_id]
    if provider_id != "fake" and not model_id:
        if emit_missing_model_error:
            emitter.error(message=f"--model is required with the {provider_id} provider")
        return None, 2
    if provider_id == "codex":
        auth = check_codex_auth()
        if not auth.ok:
            emitter.auth_failed(reason=auth.reason, docs_url=entry.docs_url)
            return None, 3
    elif provider_id != "fake":
        provider = make_provider(provider_id, root)
        status = provider.status()
        if not status.available:
            emitter.auth_failed(reason=status.reason, docs_url=entry.docs_url)
            return None, 3
    provider = make_provider(
        provider_id,
        root,
        fake_markdown=fake_markdown,
    )
    resolved_model = model_id or "fake-model"
    return (provider, resolved_model), None


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
    from arbor_worker.library import LibraryError, assert_can_write
    from arbor_worker.pipeline import run_update

    root = Path(args.root)
    settings = load_settings(root)
    emitter = EventEmitter(sys.stdout)

    try:
        assert_can_write(root)
    except LibraryError as error:
        emitter.error(message=str(error))
        emitter.run_done(processed=0, failed=0, skipped=0)
        return 1

    resolved, code = _resolve_llm_provider(args.provider, root, args.model, emitter)
    if code is not None:
        return code
    provider, _model_id = resolved

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
            commit=not args.no_commit,
        )
    except Exception as e:
        emitter.error(message=str(e))
        emitter.run_done(processed=0, failed=0, skipped=0)
        return 1
    return 0 if result.failed == 0 else 1


def _validate_commit_written_path(root: Path, rel: str) -> Path:
    if not rel or rel.startswith("/") or rel.startswith("\\"):
        raise ValueError(f"invalid relative path: {rel!r}")
    parts = Path(rel).parts
    if ".." in parts:
        raise ValueError(f"path must not contain .. segments: {rel!r}")
    resolved = (root / rel).resolve()
    root_resolved = root.resolve()
    if resolved != root_resolved and root_resolved not in resolved.parents:
        raise ValueError(f"path escapes knowledge root: {rel!r}")
    return Path(rel)


def cmd_commit_written(args) -> int:
    root = Path(args.root)
    emitter = EventEmitter(sys.stdout)
    try:
        rel_paths = [_validate_commit_written_path(root, rel) for rel in args.paths]
    except ValueError as error:
        emitter.error(message=str(error))
        return 1
    try:
        commit_and_note(root, rel_paths, args.message, emitter)
    except GitStateError as error:
        emitter.error(message=str(error))
        return 1
    from arbor_worker.sync import maybe_sync_after_commit

    maybe_sync_after_commit(root, emitter)
    if args.index:
        from arbor_worker.indexer import index_courses

        courses = sorted({p.parts[0] for p in rel_paths if p.parts})
        if courses:
            index_courses(root, courses)
    return 0


def _emit_generate_commit_paths(
    emitter: EventEmitter, paths: list[Path]
) -> None:
    emitter.emit("commit_paths", paths=[p.as_posix() for p in paths])


def cmd_generate(args) -> int:
    from arbor_worker.library import LibraryError, assert_can_write

    root = Path(args.root)
    course_dir = root / args.course
    emitter = EventEmitter(sys.stdout)
    settings = load_settings(root)
    skill = SKILLS.get(args.skill)

    try:
        assert_can_write(root)
    except LibraryError as error:
        emitter.skill_failed(
            course=args.course,
            skill=args.skill,
            message=str(error),
        )
        return 1

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
                f"# digests/{digest_path.name}\n\n{source_bytes.decode('utf-8')}"
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
    skill_inputs = (
        digest_batches(digest_sections)
        if isinstance(skill, (FlashcardsSkill, QuizSkill, ConceptsSkill))
        else [digest_text]
    )

    study_dir = course_dir / "study"
    if isinstance(skill, CitationsSkill):
        for name in ("flashcards.json", "quiz.json", "concepts.json"):
            extra = study_dir / name
            if extra.is_file():
                source_hash.update(extra.read_bytes())
        content_sha256 = source_hash.hexdigest()
    manifest_path = study_dir / "manifest.json"
    artifact_path = (
        study_dir / "concepts.json"
        if isinstance(skill, DiagramsSkill)
        else study_dir / f"{skill.name}.json"
    )
    image_paths = (
        cached_page_images(root, settings.cache_dir_name, course_dir)
        if isinstance(skill, DiagramsSkill)
        else []
    )
    if isinstance(skill, DiagramsSkill):
        for path in image_paths:
            stat = path.stat()
            source_hash.update(str(path.resolve()).encode())
            source_hash.update(stat.st_mtime_ns.to_bytes(8, "little"))
            source_hash.update(stat.st_size.to_bytes(8, "little"))
        content_sha256 = source_hash.hexdigest()
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

    if isinstance(skill, CitationsSkill):
        emitter.skill_started(course=args.course, skill=skill.name)
        try:
            artifact = skill.verify(course_dir, args.course)
        except Exception as error:
            emitter.skill_failed(
                course=args.course,
                skill=skill.name,
                message=str(error),
            )
            return 1
        for failure in artifact.failures:
            emitter.citation_failed(
                path=failure.path,
                id=failure.id,
                reason=failure.reason,
            )
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
        from arbor_worker.sync import derived_gitignore_extras

        ensure_gitignored(
            root,
            settings.cache_dir_name,
            derived_gitignore_extras(settings.cache_dir_name),
        )
        artifact_rel = artifact_path.relative_to(root)
        manifest_rel = manifest_path.relative_to(root)
        commit_rels = [manifest_rel, artifact_rel]
        if args.no_commit:
            _emit_generate_commit_paths(emitter, commit_rels)
        else:
            try:
                commit = commit_and_note(
                    root,
                    commit_rels,
                    f"study: {args.course} {skill.name}",
                    emitter,
                )
            except GitStateError as error:
                emitter.skill_failed(
                    course=args.course,
                    skill=skill.name,
                    message=str(error),
                )
                return 1
            emitter.committed(
                commit=commit,
                courses=[args.course],
                skill=skill.name,
            )
            from arbor_worker.sync import maybe_sync_after_commit

            maybe_sync_after_commit(root, emitter)
        emitter.skill_done(
            course=args.course,
            skill=skill.name,
            file=str(artifact_rel),
        )
        return 0

    if args.provider == "fake":
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
        resolved, code = _resolve_llm_provider(
            args.provider,
            root,
            args.model,
            emitter,
            fake_markdown=fake_markdown,
            emit_missing_model_error=False,
        )
    else:
        resolved, code = _resolve_llm_provider(
            args.provider,
            root,
            args.model,
            emitter,
            emit_missing_model_error=False,
        )
    if code is not None:
        if code == 2:
            emitter.skill_failed(
                course=args.course,
                skill=skill.name,
                message=f"--model is required with the {args.provider} provider",
            )
        return code
    provider, model_id = resolved

    emitter.skill_started(course=args.course, skill=skill.name)

    def emit_retry(attempt: int, error: Exception) -> None:
        emitter.skill_progress(
            course=args.course,
            skill=skill.name,
            attempt=attempt,
            attempts=3,
            message=str(error),
        )

    try:
        artifacts = [
            run_skill(
                provider,
                ProviderRequest(
                    prompt=(
                        skill.build_prompt(
                            course=args.course,
                            digest_text=skill_input,
                            image_paths=image_paths,
                        )
                        if isinstance(skill, DiagramsSkill)
                        else skill.build_prompt(
                            course=args.course,
                            digest_text=skill_input,
                        )
                    ),
                    model_id=model_id,
                    cwd=root,
                    image_paths=image_paths,
                ),
                skill,
                on_retry=emit_retry,
            )
            for skill_input in skill_inputs
        ]
        if isinstance(skill, FlashcardsSkill):
            artifact = merge_decks(artifacts)
        elif isinstance(skill, QuizSkill):
            artifact = merge_packs(artifacts)
        elif isinstance(skill, ConceptsSkill):
            artifact = merge_graphs(artifacts)
            if artifact_path.is_file():
                existing_graph = ConceptGraph.model_validate_json(
                    artifact_path.read_text()
                )
                figures = [
                    node for node in existing_graph.nodes if node.kind == "figure"
                ]
                if figures:
                    figure_ids = {node.id for node in figures}
                    known = {node.id for node in artifact.nodes} | figure_ids
                    figure_edges = [
                        edge
                        for edge in existing_graph.edges
                        if (edge.from_ in figure_ids or edge.to in figure_ids)
                        and edge.from_ in known
                        and edge.to in known
                    ]
                    artifact = merge_graphs(
                        [
                            artifact,
                            existing_graph.model_copy(
                                update={"nodes": figures, "edges": figure_edges}
                            ),
                        ]
                    )
        else:
            artifact = artifacts[0]
    except Exception as error:
        emitter.skill_failed(
            course=args.course,
            skill=skill.name,
            message=str(error),
        )
        return 1

    study_dir.mkdir(parents=True, exist_ok=True)
    written_rels: list[Path] = []
    if isinstance(skill, DiagramsSkill):
        concepts_path = study_dir / "concepts.json"
        existing = None
        if concepts_path.is_file():
            existing = ConceptGraph.model_validate_json(concepts_path.read_text())
        merged = merge_figures(existing, artifact)
        if merged is not None and merged is not existing:
            concepts_path.write_text(
                json.dumps(merged.model_dump(mode="json", by_alias=True), indent=2)
                + "\n"
            )
            written_rels.append(concepts_path.relative_to(root))
        artifact_rel = concepts_path.relative_to(root)
        manifest.artifacts[skill.name] = ManifestArtifact(
            file="concepts.json",
            content_sha256=content_sha256,
            generated_at=datetime.now(timezone.utc),
        )
    else:
        artifact_path.write_text(
            json.dumps(artifact.model_dump(mode="json", by_alias=True), indent=2) + "\n"
        )
        artifact_rel = artifact_path.relative_to(root)
        written_rels.append(artifact_rel)
        manifest.artifacts[skill.name] = ManifestArtifact(
            file=artifact_path.name,
            content_sha256=content_sha256,
            generated_at=datetime.now(timezone.utc),
        )
    write_manifest(manifest_path, manifest)
    from arbor_worker.sync import derived_gitignore_extras

    ensure_gitignored(
        root,
        settings.cache_dir_name,
        derived_gitignore_extras(settings.cache_dir_name),
    )

    manifest_rel = manifest_path.relative_to(root)
    commit_rels = [manifest_rel, *written_rels]
    if args.no_commit:
        _emit_generate_commit_paths(emitter, commit_rels)
    else:
        try:
            commit = commit_and_note(
                root,
                commit_rels,
                f"study: {args.course} {skill.name}",
                emitter,
            )
        except GitStateError as error:
            emitter.skill_failed(
                course=args.course,
                skill=skill.name,
                message=str(error),
            )
            return 1
        emitter.committed(
            commit=commit,
            courses=[args.course],
            skill=skill.name,
        )
        from arbor_worker.sync import maybe_sync_after_commit

        maybe_sync_after_commit(root, emitter)

    emitter.skill_done(
        course=args.course,
        skill=skill.name,
        file=str(artifact_rel),
    )
    return 0


def cmd_reindex(args) -> int:
    from arbor_worker.indexer import reindex_root

    totals = reindex_root(Path(args.root))
    print(json.dumps({"indexed_courses": totals, "documents": sum(totals.values())}))
    return 0


def _load_embedder(provider: str):
    from arbor_worker.embedder.fake import FakeEmbedder
    from arbor_worker.embedder.hashed import HashedNgramEmbedder

    return FakeEmbedder() if provider == "fake" else HashedNgramEmbedder()


def cmd_embed(args) -> int:
    from arbor_worker.embed import embed_root

    root = Path(args.root)
    emitter = EventEmitter(sys.stdout)
    settings = load_settings(root)
    embedder = _load_embedder(args.provider)
    emitter.embed_started(
        root=str(root),
        force=args.force,
        provider=args.provider,
    )
    try:
        counts = embed_root(
            root,
            embedder,
            force=args.force,
            settings=settings,
        )
    except Exception as error:
        emitter.embed_failed(message=str(error))
        return 1
    emitter.embed_done(
        digests=counts.digests,
        embedded=counts.embedded,
        skipped=counts.skipped,
        chunks=counts.chunks,
    )
    return 0


def cmd_embed_search(args) -> int:
    from arbor_worker.embed import search_chunks

    hits = search_chunks(
        Path(args.root),
        args.query,
        args.limit,
        _load_embedder(args.provider),
    )
    print(json.dumps(hits))
    return 0


def _commit_study_file_if_dirty(
    root: Path,
    rel_path: Path,
    message: str,
    emitter: EventEmitter,
) -> None:
    if path_has_pending_changes(root, rel_path):
        commit_and_note(root, [rel_path], message, emitter)
        from arbor_worker.sync import maybe_sync_after_commit

        maybe_sync_after_commit(root, emitter)


def _commit_study_progress_if_dirty(
    root: Path,
    course: str,
    message: str,
    emitter: EventEmitter,
) -> None:
    from arbor_worker.study_progress import progress_path

    progress_rel = progress_path(root, course).relative_to(root)
    legacy_rel = Path(course) / "study" / "progress.json"
    rel_paths: list[Path] = []
    if path_has_pending_changes(root, progress_rel):
        rel_paths.append(progress_rel)
    if path_has_pending_changes(root, legacy_rel):
        rel_paths.append(legacy_rel)
    if not rel_paths:
        return
    commit_and_note(root, rel_paths, message, emitter)
    from arbor_worker.sync import maybe_sync_after_commit

    maybe_sync_after_commit(root, emitter)


def cmd_study_progress(args) -> int:
    from arbor_worker.study_progress import (
        StudyProgressError,
        emit_json_line,
        parse_utc_now,
        study_progress_due,
        study_progress_grade,
        study_progress_quiz,
        study_progress_show,
        study_progress_weak,
    )

    action = getattr(args, "study_action", None)
    if action is None:
        print("study-progress requires a subcommand", file=sys.stderr)
        return 2
    root = Path(args.root)
    course = args.course
    emitter = EventEmitter(sys.stderr)

    def finish(doc: dict) -> int:
        try:
            _commit_study_progress_if_dirty(
                root,
                course,
                f"study: {course} progress",
                emitter,
            )
        except GitStateError as error:
            print(str(error), file=sys.stderr)
            return 1
        emit_json_line(doc)
        return 0

    def finish_mutation(doc: dict) -> int:
        try:
            _commit_study_progress_if_dirty(
                root,
                course,
                f"study: {course} progress",
                emitter,
            )
        except GitStateError as error:
            print(f"warning: {error}", file=sys.stderr)
        emit_json_line(doc)
        return 0

    try:
        if action == "show":
            return finish(study_progress_show(root, course))
        if action == "weak":
            return finish(study_progress_weak(root, course))
        if action == "due":
            now = parse_utc_now(args.now) if args.now else None
            return finish(study_progress_due(root, course, now=now))
        if action == "grade":
            now = parse_utc_now(args.now) if args.now else None
            doc = study_progress_grade(
                root,
                course,
                args.card_id,
                args.result,
                now=now,
                digest=args.digest,
                heading=args.heading,
                write_id=getattr(args, "write_id", None),
            )
            return finish_mutation(doc)
        if action == "quiz":
            now = parse_utc_now(args.now) if args.now else None
            doc = study_progress_quiz(
                root,
                course,
                args.question_id,
                args.result,
                now=now,
                digest=args.digest,
                heading=args.heading,
                write_id=getattr(args, "write_id", None),
            )
            return finish_mutation(doc)
        if action == "recommend":
            from arbor_worker.recommendations import study_recommendations

            now = parse_utc_now(args.now) if getattr(args, "now", None) else None
            return finish(study_recommendations(root, course, now=now))
        if action == "overview":
            from arbor_worker.recommendations import study_recommendations

            now = parse_utc_now(args.now) if getattr(args, "now", None) else None
            due_doc = study_progress_due(root, course, now=now)
            weak_doc = study_progress_weak(root, course)
            recommend_doc = study_recommendations(root, course, now=now)
            return finish(
                {
                    "due": due_doc,
                    "weak": weak_doc,
                    "recommend": recommend_doc,
                }
            )
    except ValueError as error:
        message = str(error)
        print(message, file=sys.stderr)
        if message.startswith("invalid course name:"):
            return 1
        return 2
    except StudyProgressError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"unknown study-progress action: {action}", file=sys.stderr)
    return 2


def cmd_study_plan(args) -> int:
    from arbor_worker.library import LibraryError, assert_can_write
    from arbor_worker.study_progress import emit_json_line
    from arbor_worker.study_plan import generate_study_plan

    root = Path(args.root)
    try:
        assert_can_write(root)
    except LibraryError as error:
        print(str(error), file=sys.stderr)
        return 1
    emitter = EventEmitter(sys.stderr)
    if args.provider == "fake":
        fake_markdown = os.environ.get(
            "ARBOR_FAKE_MD",
            json.dumps(
                {
                    "skill": "study_plan",
                    "course": args.course,
                    "ok": True,
                }
            ),
        )
        resolved, code = _resolve_llm_provider(
            args.provider,
            root,
            args.model,
            emitter,
            fake_markdown=fake_markdown,
            emit_missing_model_error=False,
        )
    else:
        resolved, code = _resolve_llm_provider(
            args.provider,
            root,
            args.model,
            emitter,
            emit_missing_model_error=False,
        )
    if code is not None:
        if code == 2:
            print(
                f"--model is required with the {args.provider} provider",
                file=sys.stderr,
            )
        return code
    provider, model_id = resolved
    try:
        result = generate_study_plan(
            root,
            args.course,
            provider,
            model_id,
            exam_date=args.exam_date,
        )
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1
    plan_rel = Path(result["path"])
    try:
        _commit_study_file_if_dirty(
            root,
            plan_rel,
            f"study: {args.course} plan",
            emitter,
        )
    except GitStateError as error:
        print(str(error), file=sys.stderr)
        return 1
    emit_json_line(result)
    return 0


def cmd_append_card(args) -> int:
    from arbor_worker.append_card import append_flashcard
    from arbor_worker.library import LibraryError, assert_can_write
    from arbor_worker.study_progress import emit_json_line

    root = Path(args.root)
    emitter = EventEmitter(sys.stderr)
    try:
        assert_can_write(root)
    except LibraryError as error:
        print(str(error), file=sys.stderr)
        return 1
    try:
        card = append_flashcard(
            root,
            args.course,
            args.front,
            args.back,
            args.digest,
            heading=args.heading,
            page=args.page,
        )
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1
    deck_rel = Path(args.course) / "study" / "flashcards.json"
    try:
        _commit_study_file_if_dirty(
            root,
            deck_rel,
            f"study: {args.course} flashcard",
            emitter,
        )
    except GitStateError as error:
        print(str(error), file=sys.stderr)
        return 1
    emit_json_line(card)
    return 0


def cmd_chat(_args) -> int:
    from arbor_worker.chat import answer
    from arbor_worker.provider.base import ProviderError
    from arbor_worker.provider.registry import make_provider

    emitter = EventEmitter(sys.stdout)
    try:
        payload = json.load(sys.stdin)
        root = Path(payload["root"])
        course = payload["course"]
        question = payload["question"]
        mode = payload["mode"]
        provider_name = payload["provider"]
        model = payload["model"]
        history = payload.get("history", [])
        budget_chars = int(payload.get("budget_chars", 12_000))
        if mode not in {"ask", "explain"}:
            raise ValueError(f"invalid mode: {mode!r}")
        provider = make_provider(provider_name, root)
        answer(
            root,
            course,
            history,
            question,
            mode,
            provider,
            model,
            budget_chars=budget_chars,
            emitter=emitter,
        )
    except ProviderError as error:
        emitter.error(message=str(error))
        return 1
    except (KeyError, TypeError, ValueError, FileNotFoundError) as error:
        emitter.error(message=str(error))
        return 1
    except Exception as error:
        emitter.error(message=str(error))
        return 1
    return 0


def _sync_report_json(report) -> dict:
    payload: dict = {"ok": report.ok, "action": report.action}
    if report.commit is not None:
        payload["commit"] = report.commit
    if report.files is not None:
        payload["files"] = report.files
    if report.head_changed:
        payload["head_changed"] = True
    return payload


def cmd_sync(args) -> int:
    from arbor_worker.sync import (
        GitSyncError,
        remote_url,
        set_remote,
        set_shared,
        sync_root,
    )

    root = Path(args.root)
    if args.set_remote is not None:
        try:
            set_remote(root, args.set_remote)
        except GitSyncError as error:
            print(str(error), file=sys.stderr)
            return 1
        print(json.dumps({"remote": remote_url(root)}))
        return 0
    if args.shared is not None:
        set_shared(root, args.shared)
        print(json.dumps({"shared": args.shared}))
        return 0
    if args.show:
        from arbor_worker import sync as sync_mod

        print(
            json.dumps(
                {
                    "remote": remote_url(root),
                    "shared": sync_mod._read_shared(root),
                    "sync_remote": sync_mod.sync_remote_name(root),
                    "remote_note": sync_mod.remote_note(root),
                }
            )
        )
        return 0
    try:
        report = sync_root(root)
    except GitSyncError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(_sync_report_json(report)))
    return 2 if not report.ok and report.action == "conflict" else 0


def cmd_sync_resolve(args) -> int:
    from arbor_worker.sync import GitSyncError, SyncConflictError, resolve_conflict

    root = Path(args.root)
    content = args.content
    if args.side == "edit" and content is None:
        content = sys.stdin.read()
    try:
        resolve_conflict(root, args.path, args.side, content=content)
    except (SyncConflictError, GitSyncError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "path": args.path}))
    return 0


def cmd_sync_continue(args) -> int:
    from arbor_worker.sync import GitSyncError, SyncConflictError, continue_sync

    root = Path(args.root)
    try:
        report = continue_sync(root)
    except SyncConflictError as error:
        print(str(error), file=sys.stderr)
        return 1
    except GitSyncError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(_sync_report_json(report)))
    if not report.ok and report.action == "conflict":
        return 2
    return 0


def cmd_library_create(args) -> int:
    from arbor_worker.library import LibraryError, create_shared_library

    root = Path(args.root)
    try:
        doc = create_shared_library(root, name=args.name)
    except LibraryError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(doc))
    return 0


def cmd_library_join(args) -> int:
    from arbor_worker.library import LibraryError, join_library

    try:
        result = join_library(args.url, Path(args.dest))
    except LibraryError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


def cmd_library_show(args) -> int:
    from arbor_worker.library import LibraryError, current_role, load_library

    root = Path(args.root)
    try:
        doc = load_library(root)
    except LibraryError as error:
        print(str(error), file=sys.stderr)
        return 1
    if doc is None:
        print(json.dumps({"present": False}))
        return 0
    role = current_role(root)
    payload = {
        "present": True,
        "name": doc["name"],
        "created_by": doc["created_by"],
        "members": doc["members"],
        "provider": doc.get("provider"),
        "role": role,
    }
    print(json.dumps(payload))
    return 0


def cmd_library_members(args) -> int:
    from arbor_worker.library import LibraryError, set_library_members

    root = Path(args.root)
    try:
        members = json.loads(args.members)
    except json.JSONDecodeError:
        print("Invalid --members JSON", file=sys.stderr)
        return 1
    if not isinstance(members, list):
        print("Invalid --members JSON", file=sys.stderr)
        return 1
    try:
        doc = set_library_members(root, members)
    except LibraryError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(doc))
    return 0


def cmd_library_provider(args) -> int:
    from arbor_worker.library import LibraryError, set_library_provider

    root = Path(args.root)
    if args.clear and (args.id is not None or args.model is not None):
        print("--clear is mutually exclusive with --id and --model", file=sys.stderr)
        return 1
    if not args.clear:
        if not args.id or not args.model:
            print("--id and --model are required unless --clear", file=sys.stderr)
            return 1
    try:
        if args.clear:
            doc = set_library_provider(root, None)
        else:
            doc = set_library_provider(root, {"id": args.id, "model": args.model})
    except LibraryError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(doc))
    return 0


def cmd_course_meta(args) -> int:
    from arbor_worker.course_meta import CourseMetaError, set_course_meta
    from arbor_worker.library import LibraryError

    if args.course_meta_action != "set":
        print("Unknown course-meta action", file=sys.stderr)
        return 1
    root = Path(args.root)
    try:
        fields = json.loads(args.fields)
    except json.JSONDecodeError:
        print("Invalid --fields JSON", file=sys.stderr)
        return 1
    if not isinstance(fields, dict):
        print("Invalid --fields JSON", file=sys.stderr)
        return 1
    icon = fields.get("icon")
    color = fields.get("color")
    if icon is not None and not isinstance(icon, str):
        print("Invalid icon in --fields", file=sys.stderr)
        return 1
    if color is not None and not isinstance(color, str):
        print("Invalid color in --fields", file=sys.stderr)
        return 1
    try:
        courses = set_course_meta(root, args.course, icon, color)
    except (CourseMetaError, LibraryError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(courses))
    return 0


def cmd_library_migrate(args) -> int:
    from arbor_worker.gitstate import commit_batch
    from arbor_worker.library import (
        LIBRARY_REL,
        LibraryError,
        assert_can_write,
        library_needs_member_migration,
        load_library,
        migrate_library_file,
    )

    root = Path(args.root)
    path = root / LIBRARY_REL
    if not path.is_file():
        print("No shared library at this folder.", file=sys.stderr)
        return 1
    needs = library_needs_member_migration(root)
    if needs:
        try:
            assert_can_write(root)
        except LibraryError as error:
            print(str(error), file=sys.stderr)
            return 1
        before = path.read_bytes()
        try:
            doc = migrate_library_file(root)
        except LibraryError as error:
            print(str(error), file=sys.stderr)
            return 1
        after = path.read_bytes()
        if before != after:
            commit_batch(root, [Path(LIBRARY_REL)], "library: migrate members")
        print(json.dumps(doc))
        return 0
    try:
        doc = load_library(root)
    except LibraryError as error:
        print(str(error), file=sys.stderr)
        return 1
    if doc is None:
        print("No shared library at this folder.", file=sys.stderr)
        return 1
    print(json.dumps(doc))
    return 0

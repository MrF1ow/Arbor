from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from arbor_worker.cache import CacheDir, ensure_gitignored
from arbor_worker.chunk_generate import ChunkedResult, chunked_generate
from arbor_worker.course_manifest import CourseManifest, DigestRecord
from arbor_worker.course_synthesis import synthesize_course
from arbor_worker.digest import build_prompt, validate_digest
from arbor_worker.digest_files import next_digest_path
from arbor_worker.errors import CourseSynthesisError, PlanError
from arbor_worker.events import EventEmitter
from arbor_worker.gitstate import GitStateError, commit_batch
from arbor_worker.hashing import hash_file
from arbor_worker.planning import SelectedSource, apply_selections, build_plan
from arbor_worker.prepare import prepare_source, PrepareError, PrepareResult
from arbor_worker.provider.base import CliProvider, ProviderRequest
from arbor_worker.settings import WorkerSettings
from arbor_worker.windowing import clip_images


@dataclass
class SourceOutcome:
    course: str
    source: str
    ok: bool
    stage_failed: str | None = None
    message: str | None = None
    digest_file: str | None = None


@dataclass
class RunResult:
    processed: int
    failed: int
    skipped: int
    commit: str | None
    outcomes: list[SourceOutcome] = field(default_factory=list)


def _cancel_requested(cancel_file: Path | None) -> bool:
    return cancel_file is not None and cancel_file.exists()


def _digest_one_source(
    *,
    root: Path,
    sel: SelectedSource,
    provider: CliProvider,
    model_id: str,
    emitter: EventEmitter,
    settings: WorkerSettings,
    cache: CacheDir,
    cancel_file: Path | None,
) -> tuple[str, dict]:
    abs_source = root / sel.path
    course_abs = root / sel.course
    course_rel = sel.course

    emitter.stage(course_dir=course_rel, source=sel.path, stage="prepare", status="start")
    source_hash = hash_file(abs_source)
    prep: PrepareResult = prepare_source(
        abs_source,
        sel.source_type,
        source_hash,
        cache,
        settings,
        on_warning=lambda m: emitter.warning(course_dir=course_rel, message=m),
    )
    emitter.stage(
        course_dir=course_rel, source=sel.path, stage="prepare",
        status="ok", detail=prep.processing_path,
    )

    start_page = sel.start_page
    images = prep.image_paths
    if prep.text is not None:
        if start_page > 1:
            emitter.warning(
                course_dir=course_rel,
                message=(
                    f"{abs_source.name}: start page ignored for extracted-text slides; "
                    "ingesting the whole file"
                ),
            )
            start_page = 1
    else:
        images = clip_images(images, start_page)

    emitter.stage(course_dir=course_rel, source=sel.path, stage="generate", status="start")
    use_chunking = prep.text is None and len(images) > settings.pdf_chunk_threshold_pages
    generate_mode = "single"
    chunk_count: int | None = None

    if use_chunking:
        chunked: ChunkedResult = chunked_generate(
            provider,
            source_name=abs_source.name,
            image_paths=images,
            model_id=model_id,
            cwd=course_abs,
            cache_dir=cache.for_hash(f"{source_hash}-p{start_page}"),
            chunk_size=settings.pdf_chunk_size_pages,
            concurrency=settings.pdf_chunk_concurrency,
            emitter=emitter,
            course_dir=course_rel,
            cancel_requested=lambda: _cancel_requested(cancel_file),
        )
        markdown = chunked.markdown
        generate_mode = "chunked"
        chunk_count = chunked.chunk_count
    else:
        request = ProviderRequest(
            prompt=build_prompt(
                abs_source.name, prep, page_start=start_page, image_count=len(images)
            ),
            model_id=model_id,
            image_paths=[p.resolve() for p in images],
            cwd=course_abs,
        )
        result = provider.run(request)
        markdown = result.markdown
        validate_digest(markdown)

    emitter.stage(course_dir=course_rel, source=sel.path, stage="generate", status="ok")
    info = {
        "source_hash": source_hash,
        "processing_path": prep.processing_path,
        "generate_mode": generate_mode,
        "chunk_count": chunk_count,
        "start_page": start_page,
        "page_count": sel.page_count,
    }
    return (markdown if markdown.endswith("\n") else markdown + "\n"), info


def run_update(
    root: Path,
    model_id: str,
    provider: CliProvider,
    emitter: EventEmitter,
    settings: WorkerSettings,
    *,
    selections: dict[str, int | None] | None = None,
    cancel_file: Path | None = None,
) -> RunResult:
    root = Path(root)
    emitter.run_started(root=str(root), model_id=model_id, provider=provider.name)

    plan = build_plan(root, settings)
    try:
        selected = apply_selections(plan, selections or {})
    except PlanError as e:
        emitter.error(message=str(e))
        emitter.run_done(processed=0, failed=0, skipped=0)
        return RunResult(0, 0, 0, None, [])

    if not selected:
        emitter.nothing_to_process()
        emitter.run_done(processed=0, failed=0, skipped=0)
        return RunResult(0, 0, 0, None, [])

    cache = CacheDir(root, settings.cache_dir_name)
    outcomes: list[SourceOutcome] = []
    commit_paths: list[Path] = []
    done_courses: list[str] = []
    processed = failed = 0
    skipped = len(plan.pending) - len(selected)
    cancelled = False

    by_course: dict[str, list[SelectedSource]] = {}
    for sel in selected:
        by_course.setdefault(sel.course, []).append(sel)

    for course_rel, course_sels in by_course.items():
        if cancelled:
            break
        course_abs = root / course_rel
        manifest = CourseManifest.load(course_abs)
        emitter.course_started(course_dir=course_rel, sources=len(course_sels))
        new_digests: list[str] = []
        digested_sources: list[Path] = []

        for sel in course_sels:
            if _cancel_requested(cancel_file):
                cancelled = True
                emitter.cancelled(after_sources=len(outcomes))
                break
            emitter.source_started(
                course_dir=course_rel, source=sel.path, start_page=sel.start_page
            )
            try:
                markdown, info = _digest_one_source(
                    root=root,
                    sel=sel,
                    provider=provider,
                    model_id=model_id,
                    emitter=emitter,
                    settings=settings,
                    cache=cache,
                    cancel_file=cancel_file,
                )
            except Exception as e:
                failed += 1
                emitter.stage(
                    course_dir=course_rel, source=sel.path,
                    stage="generate", status="fail", detail=str(e),
                )
                emitter.source_failed(course_dir=course_rel, source=sel.path, message=str(e))
                outcomes.append(SourceOutcome(course_rel, sel.path, False, "generate", str(e)))
                continue

            now = datetime.now(timezone.utc)
            digest_abs = next_digest_path(course_abs, settings.digests_dirname, now)
            try:
                digest_abs.write_text(markdown)
            except OSError as e:
                failed += 1
                emitter.source_failed(course_dir=course_rel, source=sel.path, message=str(e))
                outcomes.append(SourceOutcome(course_rel, sel.path, False, "write", str(e)))
                continue

            digest_rel = str(digest_abs.relative_to(course_abs))
            manifest.record(
                DigestRecord(
                    source_path=sel.path,
                    source_hash=info["source_hash"],
                    page_count=info["page_count"],
                    start_page=info["start_page"],
                    end_page=info["page_count"],
                    digest_file=digest_rel,
                    model_id=model_id,
                    processing_path=info["processing_path"],
                    generate_mode=info["generate_mode"],
                    chunk_count=info["chunk_count"],
                    digested_at=now.isoformat(),
                )
            )
            processed += 1
            new_digests.append(digest_rel)
            digested_sources.append(root / sel.path)
            emitter.source_done(course_dir=course_rel, source=sel.path, digest=digest_rel)
            outcomes.append(
                SourceOutcome(course_rel, sel.path, True, digest_file=digest_rel)
            )

        if not new_digests:
            emitter.course_done(course_dir=course_rel, digests=0)
            continue

        emitter.course_synthesis_started(
            course_dir=course_rel, digest_count=len(manifest.digest_files())
        )
        try:
            course_markdown = synthesize_course(
                provider,
                course_name=course_rel,
                digests=manifest.read_digests(),
                model_id=model_id,
                cwd=course_abs,
            )
        except CourseSynthesisError as e:
            emitter.course_synthesis_failed(
                course_dir=course_rel, code=CourseSynthesisError.code, message=str(e)
            )
            emitter.course_done(course_dir=course_rel, digests=len(new_digests))
            continue

        manifest.save()
        for digest_rel in new_digests:
            commit_paths.append(Path(course_rel) / digest_rel)
        commit_paths.append(Path(course_rel) / CourseManifest.FILENAME)
        done_courses.append(course_rel)

        course_file = course_abs / settings.course_file_name
        course_file.write_text(
            course_markdown if course_markdown.endswith("\n") else course_markdown + "\n"
        )
        commit_paths.append(Path(course_rel) / settings.course_file_name)
        emitter.course_synthesis_done(course_dir=course_rel)

        if settings.delete_sources_after_digest:
            for src_abs in digested_sources:
                try:
                    src_abs.unlink()
                except OSError:
                    continue
                emitter.source_deleted(
                    course_dir=course_rel, source=str(src_abs.relative_to(root))
                )
            commit_paths.append(Path(course_rel))
        else:
            for src_abs in digested_sources:
                if src_abs.is_file():
                    commit_paths.append(src_abs.relative_to(root))

        emitter.course_done(course_dir=course_rel, digests=len(new_digests))

    commit = None
    if commit_paths:
        ensure_gitignored(root, settings.cache_dir_name)
        commit_paths.append(Path(".gitignore"))
        message = "digest: " + ", ".join(done_courses)
        try:
            commit = commit_batch(root, commit_paths, message)
            emitter.committed(commit=commit, courses=done_courses)
        except GitStateError as e:
            emitter.error(message=str(e))
            emitter.run_done(processed=processed, failed=failed, skipped=skipped)
            return RunResult(processed, failed, skipped, None, outcomes)

    emitter.run_done(processed=processed, failed=failed, skipped=skipped)
    return RunResult(processed, failed, skipped, commit, outcomes)

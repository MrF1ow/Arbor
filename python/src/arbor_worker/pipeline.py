from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from arbor_worker.alignment import PageRange
from arbor_worker.cache import CacheDir, ensure_gitignored
from arbor_worker.chunk_generate import ChunkedResult, chunked_generate
from arbor_worker.course_manifest import CourseManifest, DigestRecord, SourceFingerprintState
from arbor_worker.course_synthesis import synthesize_course
from arbor_worker.digest import (
    build_patch_prompt,
    build_prompt,
    finalize_marked_digest,
    validate_digest,
)
from arbor_worker.digest_files import next_digest_path
from arbor_worker.digest_update import (
    CreateAction,
    PatchAction,
    RegenerateAction,
    classify_digest_actions,
)
from arbor_worker.errors import CourseSynthesisError, PlanError
from arbor_worker.events import EventEmitter
from arbor_worker.gitstate import GitStateError, commit_batch
from arbor_worker.hashing import hash_file
from arbor_worker.page_fingerprints import fingerprint_source
from arbor_worker.page_markers import parse_markers, replace_block
from arbor_worker.planning import SelectedSource, apply_selections, build_plan
from arbor_worker.prepare import prepare_source, PrepareError, PrepareResult
from arbor_worker.prepare.pdf import render_pdf_to_images
from arbor_worker.prepare.pptx import convert_pptx_to_pdf
from arbor_worker.provider.base import CliProvider, ProviderRequest
from arbor_worker.settings import WorkerSettings
from arbor_worker.windowing import clip_images_range


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


def _prepare_for_range(
    abs_source: Path,
    source_type: str,
    source_hash: str,
    page_range: PageRange,
    cache: CacheDir,
    settings: WorkerSettings,
    course_rel: str,
    emitter: EventEmitter,
) -> PrepareResult:
    prep = prepare_source(
        abs_source,
        source_type,
        source_hash,
        cache,
        settings,
        on_warning=lambda m: emitter.warning(course_dir=course_rel, message=m),
    )
    full_count = len(prep.image_paths) if prep.image_paths else page_range.end
    partial = page_range.start > 1 or page_range.end < full_count
    if prep.text is not None and partial and source_type == "pptx":
        import shutil
        import subprocess
        import tempfile

        emitter.warning(
            course_dir=course_rel,
            message=(
                f"{abs_source.name}: partial PPTX range uses image fallback for pages "
                f"{page_range.start}-{page_range.end}"
            ),
        )
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            pdf = convert_pptx_to_pdf(abs_source, out_dir)
            images = render_pdf_to_images(pdf, out_dir, dpi=settings.pdf_render_dpi)
        clipped = clip_images_range(images, page_range.start, page_range.end)
        return PrepareResult("pptx_images_fallback", image_paths=clipped)
    if prep.image_paths:
        clipped = clip_images_range(prep.image_paths, page_range.start, page_range.end)
        return PrepareResult(prep.processing_path, image_paths=clipped, text=prep.text)
    return prep


def _generate_marked_digest(
    *,
    abs_source: Path,
    prep: PrepareResult,
    page_range: PageRange,
    provider: CliProvider,
    model_id: str,
    course_abs: Path,
    course_rel: str,
    settings: WorkerSettings,
    cache: CacheDir,
    source_hash: str,
    emitter: EventEmitter,
    cancel_file: Path | None,
) -> tuple[str, str, int | None]:
    images = prep.image_paths
    use_chunking = prep.text is None and len(images) > settings.pdf_chunk_threshold_pages
    generate_mode = "single"
    chunk_count: int | None = None
    page_offset = page_range.start - 1

    if use_chunking:
        chunked: ChunkedResult = chunked_generate(
            provider,
            source_name=abs_source.name,
            image_paths=images,
            model_id=model_id,
            cwd=course_abs,
            cache_dir=cache.for_hash(f"{source_hash}-r{page_range.start}-{page_range.end}"),
            chunk_size=settings.pdf_chunk_size_pages,
            concurrency=settings.pdf_chunk_concurrency,
            emitter=emitter,
            course_dir=course_rel,
            cancel_requested=lambda: _cancel_requested(cancel_file),
            page_offset=page_offset,
        )
        markdown = chunked.markdown
        generate_mode = "chunked"
        chunk_count = chunked.chunk_count
    else:
        request = ProviderRequest(
            prompt=build_prompt(
                abs_source.name,
                prep,
                page_start=page_range.start,
                page_end=page_range.end,
                image_count=len(images),
            ),
            model_id=model_id,
            image_paths=[p.resolve() for p in images],
            cwd=course_abs,
        )
        result = provider.run(request)
        markdown = finalize_marked_digest(result.markdown, page_range)

    return markdown if markdown.endswith("\n") else markdown + "\n", generate_mode, chunk_count


def _patch_digest(
    *,
    digest_path: Path,
    page_range: PageRange,
    provider: CliProvider,
    model_id: str,
    course_abs: Path,
    source_name: str,
) -> str:
    parsed = parse_markers(digest_path.read_text())
    if parsed.status != "ok":
        raise ValueError(parsed.detail or "missing markers")
    block = next(b for b in parsed.blocks if b.page_range == page_range)
    request = ProviderRequest(
        prompt=build_patch_prompt(source_name, page_range, block.body),
        model_id=model_id,
        cwd=course_abs,
    )
    result = provider.run(request)
    replaced = replace_block(digest_path.read_text(), page_range, result.markdown)
    if replaced.status != "ok" or replaced.markdown is None:
        raise ValueError(replaced.detail or "patch failed")
    return replaced.markdown


def _update_source_fingerprints(
    manifest: CourseManifest,
    rel_path: str,
    abs_source: Path,
    source_type: str,
    settings: WorkerSettings,
    completed_ranges: list[PageRange],
) -> None:
    if not completed_ranges:
        return
    fp = fingerprint_source(abs_source, source_type, settings)
    existing = manifest.get_source(rel_path)
    fingerprints = list(existing.page_fingerprints) if existing else []
    if len(fingerprints) < len(fp.fingerprints):
        fingerprints.extend([""] * (len(fp.fingerprints) - len(fingerprints)))
    for page_range in completed_ranges:
        for page in range(page_range.start, page_range.end + 1):
            idx = page - 1
            if idx < len(fp.fingerprints):
                if idx >= len(fingerprints):
                    fingerprints.extend([""] * (idx + 1 - len(fingerprints)))
                fingerprints[idx] = fp.fingerprints[idx]
    manifest.set_source(
        rel_path,
        SourceFingerprintState(
            source_hash=hash_file(abs_source),
            page_count=len(fp.fingerprints),
            fingerprint_kind=fp.kind,
            page_fingerprints=fingerprints,
            updated_at=datetime.now(timezone.utc).isoformat(),
        ),
    )


def run_update(
    root: Path,
    model_id: str,
    provider: CliProvider,
    emitter: EventEmitter,
    settings: WorkerSettings,
    *,
    selections: dict[str, list[list[int]] | None] | None = None,
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
            if cancelled:
                break
            abs_source = root / sel.path
            source_hash = hash_file(abs_source)
            completed_ranges: list[PageRange] = []
            source_ok = True

            for page_range in sel.ranges:
                if _cancel_requested(cancel_file):
                    cancelled = True
                    emitter.cancelled(after_sources=len(outcomes))
                    break

                emitter.range_started(
                    course_dir=course_rel,
                    source=sel.path,
                    ranges=[[page_range.start, page_range.end]],
                )
                actions = classify_digest_actions(
                    course_abs, sel.path, page_range, manifest.records()
                )

                try:
                    emitter.stage(
                        course_dir=course_rel, source=sel.path, stage="prepare", status="start"
                    )
                    prep = _prepare_for_range(
                        abs_source,
                        sel.source_type,
                        source_hash,
                        page_range,
                        cache,
                        settings,
                        course_rel,
                        emitter,
                    )
                    emitter.stage(
                        course_dir=course_rel,
                        source=sel.path,
                        stage="prepare",
                        status="ok",
                        detail=prep.processing_path,
                    )
                except Exception as e:
                    failed += 1
                    source_ok = False
                    emitter.source_failed(course_dir=course_rel, source=sel.path, message=str(e))
                    outcomes.append(
                        SourceOutcome(course_rel, sel.path, False, "prepare", str(e))
                    )
                    break

                for action in actions:
                    if _cancel_requested(cancel_file):
                        cancelled = True
                        emitter.cancelled(after_sources=len(outcomes))
                        break
                    try:
                        if isinstance(action, CreateAction):
                            emitter.stage(
                                course_dir=course_rel,
                                source=sel.path,
                                stage="generate",
                                status="start",
                                action="create",
                            )
                            markdown, generate_mode, chunk_count = _generate_marked_digest(
                                abs_source=abs_source,
                                prep=prep,
                                page_range=action.page_range,
                                provider=provider,
                                model_id=model_id,
                                course_abs=course_abs,
                                course_rel=course_rel,
                                settings=settings,
                                cache=cache,
                                source_hash=source_hash,
                                emitter=emitter,
                                cancel_file=cancel_file,
                            )
                            now = datetime.now(timezone.utc)
                            digest_abs = next_digest_path(
                                course_abs, settings.digests_dirname, now
                            )
                            digest_abs.write_text(markdown)
                            digest_rel = str(digest_abs.relative_to(course_abs))
                            manifest.record(
                                DigestRecord(
                                    source_path=sel.path,
                                    source_hash=source_hash,
                                    page_count=sel.page_count,
                                    start_page=action.page_range.start,
                                    end_page=action.page_range.end,
                                    digest_file=digest_rel,
                                    model_id=model_id,
                                    processing_path=prep.processing_path,
                                    generate_mode=generate_mode,
                                    chunk_count=chunk_count,
                                    digested_at=now.isoformat(),
                                    page_markers_version=1,
                                )
                            )
                            new_digests.append(digest_rel)
                            completed_ranges.append(action.page_range)
                            emitter.digest_created(
                                course_dir=course_rel,
                                source=sel.path,
                                digest=digest_rel,
                                ranges=[[action.page_range.start, action.page_range.end]],
                            )

                        elif isinstance(action, PatchAction):
                            emitter.stage(
                                course_dir=course_rel,
                                source=sel.path,
                                stage="generate",
                                status="start",
                                action="patch",
                            )
                            digest_path = course_abs / action.digest_file
                            markdown = _patch_digest(
                                digest_path=digest_path,
                                page_range=action.page_range,
                                provider=provider,
                                model_id=model_id,
                                course_abs=course_abs,
                                source_name=abs_source.name,
                            )
                            digest_path.write_text(markdown)
                            completed_ranges.append(action.page_range)
                            emitter.digest_patched(
                                course_dir=course_rel,
                                source=sel.path,
                                digest=action.digest_file,
                                ranges=[[action.page_range.start, action.page_range.end]],
                            )

                        elif isinstance(action, RegenerateAction):
                            emitter.stage(
                                course_dir=course_rel,
                                source=sel.path,
                                stage="generate",
                                status="start",
                                action="regenerate",
                            )
                            markdown, generate_mode, chunk_count = _generate_marked_digest(
                                abs_source=abs_source,
                                prep=prep,
                                page_range=action.page_range,
                                provider=provider,
                                model_id=model_id,
                                course_abs=course_abs,
                                course_rel=course_rel,
                                settings=settings,
                                cache=cache,
                                source_hash=source_hash,
                                emitter=emitter,
                                cancel_file=cancel_file,
                            )
                            digest_path = course_abs / action.digest_file
                            digest_path.write_text(markdown)
                            completed_ranges.append(action.page_range)
                            emitter.digest_regenerated(
                                course_dir=course_rel,
                                source=sel.path,
                                digest=action.digest_file,
                                ranges=[[action.page_range.start, action.page_range.end]],
                            )
                    except Exception as e:
                        failed += 1
                        source_ok = False
                        emitter.source_failed(
                            course_dir=course_rel, source=sel.path, message=str(e)
                        )
                        outcomes.append(
                            SourceOutcome(course_rel, sel.path, False, "generate", str(e))
                        )
                        break

                if source_ok and completed_ranges:
                    emitter.stage(
                        course_dir=course_rel, source=sel.path, stage="generate", status="ok"
                    )

            if source_ok and completed_ranges:
                processed += 1
                digested_sources.append(abs_source)
                _update_source_fingerprints(
                    manifest,
                    sel.path,
                    abs_source,
                    sel.source_type,
                    settings,
                    completed_ranges,
                )
                emitter.source_done(course_dir=course_rel, source=sel.path)
                outcomes.append(SourceOutcome(course_rel, sel.path, True))

        if not new_digests and not any(o.ok for o in outcomes if o.course == course_rel):
            emitter.course_done(course_dir=course_rel, digests=0)
            continue

        had_success = any(o.ok for o in outcomes if o.course == course_rel)
        if not had_success:
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
        for digest_rel in manifest.digest_files():
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

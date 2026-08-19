from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path

from arbor_worker.alignment import PageRange
from arbor_worker.cache import CacheDir, ensure_gitignored
from arbor_worker.chunk_generate import chunked_generate
from arbor_worker.course_manifest import CourseManifest, DigestRecord, SourceFingerprintState
from arbor_worker.course_synthesis import build_course_index, synthesize_course
from arbor_worker.digest import validate_digest
from arbor_worker.digest_files import next_digest_path
from arbor_worker.digest_update import apply_digest_action, classify_digest_actions
from arbor_worker.errors import CourseSynthesisError, PlanError
from arbor_worker.events import EventEmitter
from arbor_worker.gitstate import GitStateError, commit_batch
from arbor_worker.hashing import hash_file
from arbor_worker.page_fingerprints import fingerprint_source
from arbor_worker.page_markers import PAGE_MARKERS_VERSION
from arbor_worker.page_markers import PageRange as MarkerPageRange
from arbor_worker.planning import SelectedSource, apply_selections, build_plan
from arbor_worker.prepare import prepare_source, PrepareResult
from arbor_worker.provider.base import CliProvider
from arbor_worker.settings import WorkerSettings
from arbor_worker.windowing import clip_window


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


def _range_pairs(ranges: list[PageRange]) -> list[list[int]]:
    return [[r.start, r.end] for r in ranges]


def _needs_image_window(sel: SelectedSource) -> bool:
    if not sel.ranges:
        return False
    return not (
        len(sel.ranges) == 1
        and sel.ranges[0].start == 1
        and sel.ranges[0].end == sel.page_count
    )


def _window_prep(prep: PrepareResult, page_range: PageRange) -> PrepareResult:
    if prep.text is not None:
        return prep
    images = clip_window(prep.image_paths, page_range.start, page_range.end)
    return replace(prep, image_paths=images)


def _pages_in(page_range: PageRange) -> set[int]:
    return set(range(page_range.start, page_range.end + 1))


def _merge_fingerprints(
    previous: SourceFingerprintState | None,
    current_fps: list[str],
    page_count: int,
    successful_pages: set[int],
) -> list[str]:
    out = [""] * page_count
    if previous is not None:
        for i, fp in enumerate(previous.page_fingerprints):
            if i < page_count:
                out[i] = fp
    for page in successful_pages:
        idx = page - 1
        if 0 <= idx < len(current_fps):
            out[idx] = current_fps[idx]
    return out


def _write_markdown(path: Path, markdown: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(markdown if markdown.endswith("\n") else markdown + "\n")


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
    manifest: CourseManifest,
    course_abs: Path,
) -> tuple[list[str], set[int], str]:
    abs_source = root / sel.path
    course_rel = sel.course
    successful_pages: set[int] = set()
    digest_rels: list[str] = []

    emitter.stage(course_dir=course_rel, source=sel.path, stage="prepare", status="start")
    source_hash = hash_file(abs_source)
    prep: PrepareResult = prepare_source(
        abs_source,
        sel.source_type,
        source_hash,
        cache,
        settings,
        on_warning=lambda m: emitter.warning(course_dir=course_rel, message=m),
        force_images=_needs_image_window(sel),
    )
    emitter.stage(
        course_dir=course_rel, source=sel.path, stage="prepare",
        status="ok", detail=prep.processing_path,
    )

    for page_range in sel.ranges:
        if _cancel_requested(cancel_file):
            raise _Cancelled()
        actions = classify_digest_actions(
            page_range,
            manifest.records(),
            course_dir=course_abs,
            source_path=sel.path,
        )
        for action in actions:
            if _cancel_requested(cancel_file):
                raise _Cancelled()
            emitter.stage(
                course_dir=course_rel,
                source=sel.path,
                stage="generate",
                status="start",
                action=action.kind,
                page_start=action.page_range.start,
                page_end=action.page_range.end,
            )
            existing = None
            digest_abs = None
            if action.digest_file:
                digest_abs = course_abs / action.digest_file
                if digest_abs.is_file():
                    existing = digest_abs.read_text()
            try:
                window_prep = _window_prep(prep, action.page_range)
                use_chunking = (
                    action.kind in ("create", "regenerate")
                    and window_prep.text is None
                    and len(window_prep.image_paths) > settings.pdf_chunk_threshold_pages
                )
                if use_chunking:
                    chunked = chunked_generate(
                        provider,
                        source_name=abs_source.name,
                        image_paths=window_prep.image_paths,
                        model_id=model_id,
                        cwd=course_abs,
                        cache_dir=cache.for_hash(
                            f"{source_hash}-p{action.page_range.start}-{action.page_range.end}"
                        ),
                        chunk_size=settings.pdf_chunk_size_pages,
                        concurrency=settings.pdf_chunk_concurrency,
                        emitter=emitter,
                        course_dir=course_rel,
                        cancel_requested=lambda: _cancel_requested(cancel_file),
                        page_offset=action.page_range.start - 1,
                        total_pages=sel.page_count,
                    )
                    markdown = chunked.markdown
                    validate_digest(
                        markdown,
                        page_range=MarkerPageRange(
                            action.page_range.start, action.page_range.end
                        ),
                    )
                    generate_mode = "chunked"
                    chunk_count = chunked.chunk_count
                else:
                    markdown = apply_digest_action(
                        action,
                        provider=provider,
                        model_id=model_id,
                        source_name=abs_source.name,
                        prep=window_prep,
                        existing_markdown=existing,
                        cwd=course_abs,
                    )
                    generate_mode = "single"
                    chunk_count = None
            except Exception:
                emitter.stage(
                    course_dir=course_rel, source=sel.path,
                    stage="generate", status="fail",
                )
                raise

            now = datetime.now(timezone.utc)
            if action.kind == "create" or digest_abs is None:
                digest_abs = next_digest_path(course_abs, settings.digests_dirname, now)
            _write_markdown(digest_abs, markdown)
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
                    page_markers_version=PAGE_MARKERS_VERSION,
                )
            )
            digest_rels.append(digest_rel)
            successful_pages.update(_pages_in(action.page_range))
            emitter.stage(
                course_dir=course_rel, source=sel.path, stage="generate", status="ok",
                action=action.kind, digest=digest_rel,
            )

    return digest_rels, successful_pages, source_hash


class _Cancelled(Exception):
    pass


def run_update(
    root: Path,
    model_id: str,
    provider: CliProvider,
    emitter: EventEmitter,
    settings: WorkerSettings,
    *,
    selections: dict[str, list[PageRange] | None] | None = None,
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

    selected = [sel for sel in selected if sel.ranges]
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
                course_dir=course_rel,
                source=sel.path,
                ranges=_range_pairs(sel.ranges),
            )
            try:
                digest_rels, successful_pages, source_hash = _digest_one_source(
                    root=root,
                    sel=sel,
                    provider=provider,
                    model_id=model_id,
                    emitter=emitter,
                    settings=settings,
                    cache=cache,
                    cancel_file=cancel_file,
                    manifest=manifest,
                    course_abs=course_abs,
                )
            except _Cancelled:
                cancelled = True
                emitter.cancelled(after_sources=len(outcomes))
                break
            except Exception as e:
                failed += 1
                emitter.source_failed(course_dir=course_rel, source=sel.path, message=str(e))
                outcomes.append(SourceOutcome(course_rel, sel.path, False, "generate", str(e)))
                continue

            if not digest_rels:
                continue

            fp = fingerprint_source(root / sel.path, settings)
            fingerprints = _merge_fingerprints(
                manifest.get_source(sel.path),
                fp.fingerprints,
                sel.page_count,
                successful_pages,
            )
            manifest.set_source(
                sel.path,
                SourceFingerprintState(
                    source_hash=source_hash,
                    page_count=sel.page_count,
                    fingerprint_kind=fp.kind,
                    page_fingerprints=fingerprints,
                    updated_at=datetime.now(timezone.utc).isoformat(),
                ),
            )

            processed += 1
            new_digests.extend(digest_rels)
            digested_sources.append(root / sel.path)
            emitter.source_done(
                course_dir=course_rel, source=sel.path, digest=digest_rels[-1]
            )
            outcomes.append(
                SourceOutcome(course_rel, sel.path, True, digest_file=digest_rels[-1])
            )

        if not new_digests:
            emitter.course_done(course_dir=course_rel, digests=0)
            continue

        emitter.course_synthesis_started(
            course_dir=course_rel, digest_count=len(manifest.digest_files())
        )
        try:
            digests = manifest.read_digests()
            if len(digests) < 2:
                course_markdown = build_course_index(course_rel, digests)
            else:
                course_markdown = synthesize_course(
                    provider,
                    course_name=course_rel,
                    digests=digests,
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

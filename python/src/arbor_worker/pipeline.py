from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from arbor_worker.cache import CacheDir, ensure_gitignored
from arbor_worker.digest import build_prompt, validate_digest, DigestError
from arbor_worker.events import EventEmitter
from arbor_worker.gitstate import (
    commit_batch,
    dirty_sources,
    validate_single_source_per_lecture,
)
from arbor_worker.hashing import hash_file
from arbor_worker.metadata import build_metadata, write_metadata
from arbor_worker.prepare import prepare_source, PrepareError, PrepareResult
from arbor_worker.provider.base import CliProvider, ProviderRequest
from arbor_worker.settings import WorkerSettings


@dataclass
class LectureOutcome:
    lecture_dir: str
    source: str
    ok: bool
    stage_failed: str | None = None
    message: str | None = None
    committed_paths: list[Path] = field(default_factory=list)


@dataclass
class RunResult:
    processed: int
    failed: int
    skipped: int
    commit: str | None
    outcomes: list[LectureOutcome]


def _cancel_requested(cancel_file: Path | None) -> bool:
    return cancel_file is not None and cancel_file.exists()


def run_update(
    root: Path,
    model_id: str,
    provider: CliProvider,
    emitter: EventEmitter,
    settings: WorkerSettings,
    *,
    cancel_file: Path | None = None,
) -> RunResult:
    root = Path(root)
    emitter.run_started(root=str(root), model_id=model_id, provider=provider.name)

    sources = dirty_sources(root)
    validate_single_source_per_lecture(sources)

    if not sources:
        emitter.nothing_to_process()
        emitter.run_done(processed=0, failed=0, skipped=0)
        return RunResult(0, 0, 0, None, [])

    cache = CacheDir(root, settings.cache_dir_name)
    outcomes: list[LectureOutcome] = []
    commit_paths: list[Path] = []
    processed = failed = 0
    cancelled = False

    for src in sources:
        if _cancel_requested(cancel_file):
            cancelled = True
            emitter.cancelled(after_lecture=len(outcomes))
            break

        lecture_dir_rel = str(src.lecture_dir)
        abs_source = root / src.path
        abs_dir = root / src.lecture_dir
        emitter.lecture_started(lecture_dir=lecture_dir_rel, source=str(src.path))

        # Discover ------------------------------------------------------
        emitter.stage(lecture_dir=lecture_dir_rel, stage="discover", status="start")
        if not abs_source.is_file() or abs_source.stat().st_size == 0:
            failed += 1
            emitter.stage(lecture_dir=lecture_dir_rel, stage="discover", status="fail")
            emitter.lecture_failed(lecture_dir=lecture_dir_rel, stage="discover", message="Source missing or empty")
            outcomes.append(LectureOutcome(lecture_dir_rel, str(src.path), False, "discover", "Source missing or empty"))
            continue
        emitter.stage(lecture_dir=lecture_dir_rel, stage="discover", status="ok")

        source_hash = hash_file(abs_source)

        # Prepare -------------------------------------------------------
        emitter.stage(lecture_dir=lecture_dir_rel, stage="prepare", status="start")
        try:
            prep: PrepareResult = prepare_source(
                abs_source,
                src.source_type,
                source_hash,
                cache,
                settings,
                on_warning=lambda m, d=lecture_dir_rel: emitter.warning(lecture_dir=d, message=m),
            )
        except PrepareError as e:
            failed += 1
            emitter.stage(lecture_dir=lecture_dir_rel, stage="prepare", status="fail", detail=str(e))
            emitter.lecture_failed(lecture_dir=lecture_dir_rel, stage="prepare", message=str(e))
            outcomes.append(LectureOutcome(lecture_dir_rel, str(src.path), False, "prepare", str(e)))
            continue
        emitter.stage(lecture_dir=lecture_dir_rel, stage="prepare", status="ok", detail=prep.processing_path)

        # Generate ------------------------------------------------------
        emitter.stage(lecture_dir=lecture_dir_rel, stage="generate", status="start")
        request = ProviderRequest(
            prompt=build_prompt(abs_source.name, prep),
            model_id=model_id,
            image_paths=[p.resolve() for p in prep.image_paths],
            cwd=abs_dir,
        )
        try:
            result = provider.run(request)
            validate_digest(result.markdown)
        except (DigestError, Exception) as e:  # provider errors surface here
            failed += 1
            emitter.stage(lecture_dir=lecture_dir_rel, stage="generate", status="fail", detail=str(e))
            emitter.lecture_failed(lecture_dir=lecture_dir_rel, stage="generate", message=str(e))
            outcomes.append(LectureOutcome(lecture_dir_rel, str(src.path), False, "generate", str(e)))
            continue
        emitter.stage(lecture_dir=lecture_dir_rel, stage="generate", status="ok")

        # Write ---------------------------------------------------------
        emitter.stage(lecture_dir=lecture_dir_rel, stage="write", status="start")
        try:
            lecture_md = abs_dir / "lecture.md"
            metadata_json = abs_dir / "metadata.json"
            lecture_md.write_text(result.markdown if result.markdown.endswith("\n") else result.markdown + "\n")
            meta = build_metadata(abs_source, src.source_type, source_hash, model_id, prep.processing_path)
            write_metadata(meta, metadata_json)
            if lecture_md.stat().st_size == 0 or metadata_json.stat().st_size == 0:
                raise OSError("Wrote empty digest artifacts")
        except OSError as e:
            failed += 1
            emitter.stage(lecture_dir=lecture_dir_rel, stage="write", status="fail", detail=str(e))
            emitter.lecture_failed(lecture_dir=lecture_dir_rel, stage="write", message=str(e))
            outcomes.append(LectureOutcome(lecture_dir_rel, str(src.path), False, "write", str(e)))
            continue
        emitter.stage(lecture_dir=lecture_dir_rel, stage="write", status="ok")

        processed += 1
        paths = [src.path, src.lecture_dir / "lecture.md", src.lecture_dir / "metadata.json"]
        commit_paths.extend(paths)
        emitter.lecture_done(lecture_dir=lecture_dir_rel)
        outcomes.append(LectureOutcome(lecture_dir_rel, str(src.path), True, committed_paths=paths))

    commit = None
    if commit_paths:
        ensure_gitignored(root, settings.cache_dir_name)
        commit_paths.append(Path(".gitignore"))
        done_dirs = [o.lecture_dir for o in outcomes if o.ok]
        message = "digest: " + ", ".join(done_dirs)
        commit = commit_batch(root, commit_paths, message)
        emitter.committed(commit=commit, lectures=done_dirs)

    skipped = 0  # unchanged sources never enter `sources`
    emitter.run_done(processed=processed, failed=failed, skipped=skipped)
    if cancelled:
        pass
    return RunResult(processed, failed, skipped, commit, outcomes)

from __future__ import annotations

from collections import deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from pathlib import Path

from arbor_worker.chunk_manifest import ChunkManifest
from arbor_worker.chunking import ChunkPlan, plan_chunks
from arbor_worker.digest import (
    build_chunk_prompt,
    build_synthesis_prompt,
    validate_chunk_digest,
    validate_digest,
)
from arbor_worker.errors import ChunkGenerateError, SynthesisError
from arbor_worker.provider.base import CliProvider, ProviderRequest


@dataclass(frozen=True)
class ChunkedResult:
    markdown: str
    chunk_count: int
    chunk_size: int
    page_ranges: list[str]


def _run_one_chunk(provider, plan: ChunkPlan, *, source_name, total_pages, model_id, cwd) -> str:
    prompt = build_chunk_prompt(
        source_name=source_name,
        page_start=plan.page_start,
        page_end=plan.page_end,
        total_pages=total_pages,
        image_count=len(plan.image_paths),
    )
    request = ProviderRequest(
        prompt=prompt,
        model_id=model_id,
        image_paths=[p.resolve() for p in plan.image_paths],
        cwd=cwd,
    )
    result = provider.run(request)
    validate_chunk_digest(result.markdown)
    return result.markdown


def chunked_generate(
    provider: CliProvider,
    *,
    source_name: str,
    image_paths: list[Path],
    model_id: str,
    cwd: Path,
    cache_dir: Path,
    chunk_size: int,
    concurrency: int,
    emitter,
    course_dir: str,
    cancel_requested,
) -> ChunkedResult:
    cache_dir = Path(cache_dir)
    plans = plan_chunks(image_paths, chunk_size)
    plan_by_id = {p.chunk_id: p for p in plans}
    manifest = ChunkManifest.load_or_create(
        cache_dir,
        plans=plans,
        chunk_size=chunk_size,
        page_count=len(image_paths),
        model_id=model_id,
    )
    total_pages = len(image_paths)

    todo = deque(plan_by_id[c["id"]] for c in manifest.pending_chunks())
    fut_plan: dict = {}
    failed_error: str | None = None
    stopped = False

    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
        while True:
            while (
                failed_error is None
                and not stopped
                and todo
                and len(fut_plan) < max(1, concurrency)
            ):
                if cancel_requested():
                    stopped = True
                    break
                plan = todo.popleft()
                emitter.chunk_started(
                    course_dir=course_dir, chunk_id=plan.chunk_id,
                    page_start=plan.page_start, page_end=plan.page_end,
                    index=plan.index, total=plan.total,
                )
                fut = pool.submit(
                    _run_one_chunk, provider, plan,
                    source_name=source_name, total_pages=total_pages,
                    model_id=model_id, cwd=cwd,
                )
                fut_plan[fut] = plan

            if not fut_plan:
                break

            done, _ = wait(list(fut_plan), return_when=FIRST_COMPLETED)
            for fut in done:
                plan = fut_plan.pop(fut)
                try:
                    markdown = fut.result()
                except Exception as e:  # provider or validation failure
                    failed_error = str(e)
                    manifest.mark_failed(plan.chunk_id, failed_error)
                    emitter.chunk_failed(
                        course_dir=course_dir, chunk_id=plan.chunk_id,
                        page_start=plan.page_start, page_end=plan.page_end,
                        code=ChunkGenerateError.code, message=failed_error,
                    )
                    continue
                digest_name = f"chunk-{plan.chunk_id}.md"
                (cache_dir / digest_name).write_text(
                    markdown if markdown.endswith("\n") else markdown + "\n"
                )
                manifest.mark_ok(plan.chunk_id, digest_name)
                emitter.chunk_done(
                    course_dir=course_dir, chunk_id=plan.chunk_id,
                    page_start=plan.page_start, page_end=plan.page_end,
                    index=plan.index, total=plan.total,
                )

    if failed_error is not None:
        raise ChunkGenerateError(f"Chunk generation failed: {failed_error}")
    if not manifest.all_ok():
        raise ChunkGenerateError("Chunk generation incomplete (cancelled or stopped)")
    if cancel_requested():
        raise ChunkGenerateError("Chunk generation incomplete (cancelled or stopped)")

    emitter.synthesis_started(course_dir=course_dir, chunk_count=len(plans))
    manifest.set_synthesis("pending")
    synth_prompt = build_synthesis_prompt(source_name, manifest.ordered_digests())
    try:
        result = provider.run(
            ProviderRequest(prompt=synth_prompt, model_id=model_id, cwd=cwd)
        )
        validate_digest(result.markdown)
    except Exception as e:
        manifest.set_synthesis("failed", str(e))
        emitter.synthesis_failed(
            course_dir=course_dir, code=SynthesisError.code, message=str(e)
        )
        raise SynthesisError(f"Synthesis failed: {e}")

    manifest.set_synthesis("ok")
    emitter.synthesis_done(course_dir=course_dir)
    return ChunkedResult(
        markdown=result.markdown,
        chunk_count=len(plans),
        chunk_size=chunk_size,
        page_ranges=manifest.page_ranges(),
    )

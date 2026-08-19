from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal, Mapping, Sequence

from arbor_worker.alignment import PageRange
from arbor_worker.course_manifest import DigestRecord
from arbor_worker.digest import DigestError, build_prompt, validate_digest
from arbor_worker.page_markers import (
    PageRange as MarkerPageRange,
    parse_page_markers,
    replace_page_marker,
)
from arbor_worker.prepare import PrepareResult
from arbor_worker.provider.base import CliProvider, ProviderRequest

DigestActionKind = Literal["create", "patch", "regenerate"]


@dataclass(frozen=True)
class DigestAction:
    kind: DigestActionKind
    page_range: PageRange
    digest_file: str | None = None


def classify_digest_actions(
    confirmed: PageRange,
    records: Sequence[DigestRecord | dict],
    *,
    course_dir: Path | None = None,
    markdown_by_file: Mapping[str, str] | None = None,
    source_path: str | None = None,
) -> list[DigestAction]:
    actions: list[DigestAction] = []
    covered: list[PageRange] = []

    for rec in _unique_records(records, source_path):
        digest_file = rec["digest_file"]
        record_range = PageRange(int(rec["start_page"]), int(rec["end_page"]))
        markdown = _lookup_markdown(digest_file, course_dir, markdown_by_file)
        status, coverage = _record_coverage(markdown, record_range)

        if status in ("missing", "malformed"):
            if _intersect(confirmed, record_range) is None:
                continue
            actions.append(DigestAction("regenerate", record_range, digest_file))
            covered.append(record_range)
            continue

        overlaps = [inter for r in coverage if (inter := _intersect(confirmed, r)) is not None]
        if not overlaps:
            continue

        if all(_contains(confirmed, r) for r in coverage):
            bounds = PageRange(
                min(r.start for r in coverage),
                max(r.end for r in coverage),
            )
            actions.append(DigestAction("regenerate", bounds, digest_file))
            covered.extend(coverage)
            continue

        actions.extend(DigestAction("patch", overlap, digest_file) for overlap in overlaps)
        covered.extend(overlaps)

    actions.extend(
        DigestAction("create", gap, None) for gap in _subtract(confirmed, covered)
    )
    actions.sort(key=lambda a: (a.page_range.start, a.page_range.end, a.kind))
    return actions


def apply_digest_action(
    action: DigestAction,
    *,
    provider: CliProvider,
    model_id: str,
    source_name: str,
    prep: PrepareResult,
    existing_markdown: str | None = None,
    cwd: Path | None = None,
) -> str:
    cwd = Path(".") if cwd is None else Path(cwd)
    if action.kind in ("create", "regenerate"):
        return _generate_marked_digest(
            action.page_range,
            provider=provider,
            model_id=model_id,
            source_name=source_name,
            prep=prep,
            cwd=cwd,
        )
    if existing_markdown is None:
        raise DigestError("patch requires existing digest markdown")
    return _apply_patch(
        action.page_range,
        existing_markdown,
        provider=provider,
        model_id=model_id,
        source_name=source_name,
        prep=prep,
        cwd=cwd,
    )


def _generate_marked_digest(
    page_range: PageRange,
    *,
    provider: CliProvider,
    model_id: str,
    source_name: str,
    prep: PrepareResult,
    cwd: Path,
) -> str:
    result = _run_provider(
        page_range,
        provider=provider,
        model_id=model_id,
        source_name=source_name,
        prep=prep,
        cwd=cwd,
    )
    markdown = result.markdown
    validate_digest(markdown, page_range=_to_marker_range(page_range))
    return markdown if markdown.endswith("\n") else markdown + "\n"


def _apply_patch(
    page_range: PageRange,
    existing_markdown: str,
    *,
    provider: CliProvider,
    model_id: str,
    source_name: str,
    prep: PrepareResult,
    cwd: Path,
) -> str:
    parsed = parse_page_markers(existing_markdown)
    if parsed.status != "ok" or not parsed.spans:
        raise DigestError("digest is unpatchable: missing or malformed arbor-pages markers")

    targets = [
        span
        for span in parsed.spans
        if _ranges_overlap(_from_marker_range(span.page_range), page_range)
    ]
    if not targets:
        raise DigestError("no arbor-pages block overlaps the patch range")

    markdown = existing_markdown
    for span in targets:
        block = _from_marker_range(span.page_range)
        generated = _run_provider(
            block,
            provider=provider,
            model_id=model_id,
            source_name=source_name,
            prep=prep,
            cwd=cwd,
        ).markdown
        inner = _extract_inner(generated, block)
        patched = replace_page_marker(markdown, span.page_range, inner)
        if patched.status != "ok" or patched.markdown is None:
            raise DigestError(
                f"failed to replace arbor-pages {span.page_range.start}-{span.page_range.end}"
            )
        markdown = patched.markdown
    return markdown


def _run_provider(
    page_range: PageRange,
    *,
    provider: CliProvider,
    model_id: str,
    source_name: str,
    prep: PrepareResult,
    cwd: Path,
):
    prompt = build_prompt(
        source_name,
        prep,
        page_start=page_range.start,
        page_end=page_range.end,
    )
    return provider.run(
        ProviderRequest(
            prompt=prompt,
            model_id=model_id,
            image_paths=[p.resolve() for p in prep.image_paths],
            cwd=cwd,
        )
    )


def _extract_inner(markdown: str, block: PageRange) -> str:
    parsed = parse_page_markers(markdown)
    if parsed.status == "ok" and parsed.spans:
        wanted = _to_marker_range(block)
        for span in parsed.spans:
            if span.page_range == wanted:
                return span.body
        return parsed.spans[0].body
    return markdown.strip("\n")


def _unique_records(
    records: Sequence[DigestRecord | dict],
    source_path: str | None,
) -> list[dict]:
    latest: dict[str, dict] = {}
    order: list[str] = []
    for rec in records:
        data = asdict(rec) if isinstance(rec, DigestRecord) else dict(rec)
        if source_path is not None and data.get("source_path") != source_path:
            continue
        key = data["digest_file"]
        if key not in latest:
            order.append(key)
        latest[key] = data
    return [latest[key] for key in order]


def _lookup_markdown(
    digest_file: str,
    course_dir: Path | None,
    markdown_by_file: Mapping[str, str] | None,
) -> str | None:
    if markdown_by_file is not None and digest_file in markdown_by_file:
        return markdown_by_file[digest_file]
    if course_dir is not None:
        path = Path(course_dir) / digest_file
        if path.is_file():
            return path.read_text()
    return None


def _record_coverage(
    markdown: str | None,
    record_range: PageRange,
) -> tuple[str, list[PageRange]]:
    if markdown is None:
        return "missing", [record_range]
    parsed = parse_page_markers(markdown)
    if parsed.status == "malformed":
        return "malformed", [record_range]
    if not parsed.spans:
        return "missing", [record_range]
    return "ok", [_from_marker_range(span.page_range) for span in parsed.spans]


def _to_marker_range(page_range: PageRange) -> MarkerPageRange:
    return MarkerPageRange(page_range.start, page_range.end)


def _from_marker_range(page_range: MarkerPageRange) -> PageRange:
    return PageRange(page_range.start, page_range.end)


def _intersect(left: PageRange, right: PageRange) -> PageRange | None:
    start = max(left.start, right.start)
    end = min(left.end, right.end)
    if start > end:
        return None
    return PageRange(start, end)


def _contains(outer: PageRange, inner: PageRange) -> bool:
    return outer.start <= inner.start and inner.end <= outer.end


def _ranges_overlap(left: PageRange, right: PageRange) -> bool:
    return not (left.end < right.start or right.end < left.start)


def _subtract(whole: PageRange, parts: Sequence[PageRange]) -> list[PageRange]:
    taken = set()
    for part in parts:
        taken.update(range(part.start, part.end + 1))
    gaps: list[PageRange] = []
    gap_start: int | None = None
    for page in range(whole.start, whole.end + 1):
        if page in taken:
            if gap_start is not None:
                gaps.append(PageRange(gap_start, page - 1))
                gap_start = None
            continue
        if gap_start is None:
            gap_start = page
    if gap_start is not None:
        gaps.append(PageRange(gap_start, whole.end))
    return gaps

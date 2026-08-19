from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from arbor_worker.alignment import AlignmentStatus, PageRange, align_fingerprints
from arbor_worker.course_manifest import CourseManifest
from arbor_worker.courses import discover_sources
from arbor_worker.errors import PlanError
from arbor_worker.hashing import hash_file
from arbor_worker.page_fingerprints import fingerprint_source
from arbor_worker.probe import count_pages
from arbor_worker.settings import WorkerSettings


@dataclass(frozen=True)
class PendingSource:
    path: str
    course: str
    source_type: str
    page_count: int
    suggested_ranges: list[PageRange]
    alignment_status: AlignmentStatus
    previously_digested: bool


@dataclass(frozen=True)
class UpdatePlan:
    pending: list[PendingSource]


@dataclass(frozen=True)
class SelectedSource:
    path: str
    course: str
    source_type: str
    page_count: int
    ranges: list[PageRange]


def build_plan(root: Path, settings: WorkerSettings) -> UpdatePlan:
    root = Path(root)
    sources = discover_sources(
        root,
        cache_dir_name=settings.cache_dir_name,
        digests_dirname=settings.digests_dirname,
    )
    manifests: dict[str, CourseManifest] = {}
    pending: list[PendingSource] = []

    for src in sources:
        course_rel = str(src.course_dir)
        manifest = manifests.get(course_rel)
        if manifest is None:
            manifest = CourseManifest.load(root / src.course_dir)
            manifests[course_rel] = manifest

        rel = str(src.path)
        abs_path = root / src.path
        source_hash = hash_file(abs_path)
        if manifest.is_current(rel, source_hash):
            continue

        page_count = count_pages(abs_path, src.source_type)
        previous = manifest.latest_for(rel)
        suggested_ranges, alignment_status = _suggest_ranges(
            manifest,
            rel,
            abs_path,
            page_count,
            previous,
            settings,
            source_hash,
        )

        pending.append(
            PendingSource(
                path=rel,
                course=course_rel,
                source_type=src.source_type,
                page_count=page_count,
                suggested_ranges=suggested_ranges,
                alignment_status=alignment_status,
                previously_digested=previous is not None,
            )
        )

    return UpdatePlan(pending=pending)


def plan_to_dict(plan: UpdatePlan) -> dict:
    """Serialize a plan for CLI/desktop JSON.

    Each pending item includes ``suggested_ranges`` as ``[start, end]`` pairs
    (1-based, inclusive) and ``alignment_status`` (``clean_append``,
    ``changed``, ``ambiguous``, or ``identical``). Empty ``suggested_ranges``
    with ``changed`` is truncation/delete-only — not a full-file ingest hint.
    Blank/empty selection ranges still mean ingest-all except for that case.
    """
    return {
        "pending": [
            {
                "path": p.path,
                "course": p.course,
                "source_type": p.source_type,
                "page_count": p.page_count,
                "suggested_ranges": [[r.start, r.end] for r in p.suggested_ranges],
                "alignment_status": p.alignment_status,
                "previously_digested": p.previously_digested,
            }
            for p in plan.pending
        ]
    }


def apply_selections(
    plan: UpdatePlan,
    selections: dict[str, list[PageRange] | None],
) -> list[SelectedSource]:
    by_path = {p.path: p for p in plan.pending}
    unknown = sorted(set(selections) - set(by_path))
    if unknown:
        raise PlanError(f"Unknown source(s) in selection: {', '.join(unknown)}")

    chosen = [p for p in plan.pending if not selections or p.path in selections]
    out: list[SelectedSource] = []
    for p in chosen:
        requested = selections.get(p.path)
        ranges = _effective_ranges(p, requested)
        _validate_ranges(p.path, ranges, p.page_count)
        out.append(
            SelectedSource(
                path=p.path,
                course=p.course,
                source_type=p.source_type,
                page_count=p.page_count,
                ranges=ranges,
            )
        )
    return out


def _suggest_ranges(
    manifest: CourseManifest,
    rel: str,
    abs_path: Path,
    page_count: int,
    previous: dict | None,
    settings: WorkerSettings,
    source_hash: str,
) -> tuple[list[PageRange], AlignmentStatus]:
    stored = manifest.get_source(rel)
    if stored is not None and stored.page_fingerprints:
        if stored.source_hash == source_hash:
            uncovered = _uncovered_ranges(stored.page_fingerprints, page_count)
            if uncovered:
                return uncovered, "changed"
        current = fingerprint_source(abs_path, settings)
        result = align_fingerprints(stored.page_fingerprints, current.fingerprints)
        return result.suggested_ranges, result.status

    if previous is not None and page_count > int(previous["page_count"]):
        return [PageRange(int(previous["page_count"]) + 1, page_count)], "clean_append"
    return [], "ambiguous"


def _uncovered_ranges(fingerprints: list[str], page_count: int) -> list[PageRange]:
    fps = list(fingerprints) + [""] * max(0, page_count - len(fingerprints))
    pages = [i + 1 for i, fp in enumerate(fps[:page_count]) if not fp]
    if not pages:
        return []
    ranges: list[PageRange] = []
    start = prev = pages[0]
    for page in pages[1:]:
        if page == prev + 1:
            prev = page
            continue
        ranges.append(PageRange(start, prev))
        start = prev = page
    ranges.append(PageRange(start, prev))
    return ranges


def _delete_only_changed(pending: PendingSource) -> bool:
    return pending.alignment_status == "changed" and not pending.suggested_ranges


def _effective_ranges(
    pending: PendingSource,
    requested: list[PageRange] | None,
) -> list[PageRange]:
    if requested:
        return list(requested)
    if _delete_only_changed(pending):
        return []
    if pending.suggested_ranges:
        return list(pending.suggested_ranges)
    if pending.page_count < 1:
        return []
    return [PageRange(1, pending.page_count)]


def _validate_ranges(path: str, ranges: list[PageRange], page_count: int) -> None:
    for r in ranges:
        if r.start < 1 or r.end > page_count or r.start > r.end:
            raise PlanError(
                f"{path}: range {r.start}-{r.end} out of range 1-{page_count}"
            )

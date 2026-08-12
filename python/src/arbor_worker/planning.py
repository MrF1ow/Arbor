from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from arbor_worker.alignment import AlignmentResult, PageRange, align_fingerprints
from arbor_worker.course_manifest import CourseManifest, SourceFingerprintState
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
    alignment_status: str
    previously_digested: bool


@dataclass(frozen=True)
class SelectedSource:
    path: str
    course: str
    source_type: str
    page_count: int
    ranges: list[PageRange]


@dataclass(frozen=True)
class UpdatePlan:
    pending: list[PendingSource]


def _legacy_grown_range(previous: dict, page_count: int) -> list[PageRange]:
    prev_pages = int(previous["page_count"])
    if page_count > prev_pages:
        return [PageRange(prev_pages + 1, page_count)]
    return []


def _suggest_for_source(
    manifest: CourseManifest,
    rel: str,
    abs_path: Path,
    source_type: str,
    page_count: int,
    previous: dict | None,
    settings: WorkerSettings,
) -> tuple[list[PageRange], str]:
    stored = manifest.get_source(rel)
    if stored is not None and stored.page_fingerprints:
        current = fingerprint_source(abs_path, source_type, settings)
        alignment: AlignmentResult = align_fingerprints(
            stored.page_fingerprints,
            current.fingerprints,
        )
        return alignment.suggested_ranges, alignment.status

    if previous is not None:
        return _legacy_grown_range(previous, page_count), "changed"
    return [], "changed"


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
        suggested_ranges, alignment_status = _suggest_for_source(
            manifest,
            rel,
            abs_path,
            src.source_type,
            page_count,
            previous,
            settings,
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


def _validate_ranges(path: str, page_count: int, ranges: list[PageRange]) -> None:
    for r in ranges:
        if r.start < 1 or r.end > page_count or r.end < r.start:
            raise PlanError(
                f"{path}: range {r.start}-{r.end} out of bounds 1-{page_count}"
            )


def _coerce_ranges(raw: list[list[int]] | None, page_count: int) -> list[PageRange]:
    if not raw:
        return [PageRange(1, page_count)]
    return [PageRange(int(start), int(end)) for start, end in raw]


def apply_selections(
    plan: UpdatePlan,
    selections: dict[str, list[list[int]] | None],
) -> list[SelectedSource]:
    by_path = {p.path: p for p in plan.pending}
    unknown = sorted(set(selections) - set(by_path))
    if unknown:
        raise PlanError(f"Unknown source(s) in selection: {', '.join(unknown)}")

    chosen = [p for p in plan.pending if not selections or p.path in selections]
    out: list[SelectedSource] = []
    for p in chosen:
        requested = selections.get(p.path)
        ranges = _coerce_ranges(requested, p.page_count)
        _validate_ranges(p.path, p.page_count, ranges)
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

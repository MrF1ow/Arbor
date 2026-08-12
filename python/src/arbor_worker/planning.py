from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from arbor_worker.course_manifest import CourseManifest
from arbor_worker.courses import discover_sources
from arbor_worker.errors import PlanError
from arbor_worker.hashing import hash_file
from arbor_worker.probe import count_pages
from arbor_worker.settings import WorkerSettings


@dataclass(frozen=True)
class PendingSource:
    path: str
    course: str
    source_type: str
    page_count: int
    suggested_start_page: int | None
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
    start_page: int


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
        suggested = None
        if previous is not None and page_count > int(previous["page_count"]):
            suggested = int(previous["page_count"]) + 1

        pending.append(
            PendingSource(
                path=rel,
                course=course_rel,
                source_type=src.source_type,
                page_count=page_count,
                suggested_start_page=suggested,
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
                "suggested_start_page": p.suggested_start_page,
                "previously_digested": p.previously_digested,
            }
            for p in plan.pending
        ]
    }


def apply_selections(
    plan: UpdatePlan,
    selections: dict[str, int | None],
) -> list[SelectedSource]:
    by_path = {p.path: p for p in plan.pending}
    unknown = sorted(set(selections) - set(by_path))
    if unknown:
        raise PlanError(f"Unknown source(s) in selection: {', '.join(unknown)}")

    chosen = [p for p in plan.pending if not selections or p.path in selections]
    out: list[SelectedSource] = []
    for p in chosen:
        requested = selections.get(p.path)
        start_page = 1 if requested is None else int(requested)
        if start_page < 1 or start_page > p.page_count:
            raise PlanError(
                f"{p.path}: start page {start_page} out of range 1-{p.page_count}"
            )
        out.append(
            SelectedSource(
                path=p.path,
                course=p.course,
                source_type=p.source_type,
                page_count=p.page_count,
                start_page=start_page,
            )
        )
    return out

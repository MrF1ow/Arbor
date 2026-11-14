import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { LectureBadge } from "~/components/workspace/lecture-badge";
import { useAddFiles } from "~/components/workspace/use-add-files";
import { Checkbox } from "~/components/ui/checkbox";
import { Skeleton } from "~/components/ui/skeleton";
import { courseDisplayName } from "~/domain/course";
import { VIEWER_WRITE_REASON, viewerBlocksWrite } from "~/domain/library-role";
import {
  countLectures,
  filterLectures,
  type LectureFilter,
  type UnitRows,
} from "~/domain/lectures";
import { digestSlugFromPath } from "~/domain/notes";
import { classPath } from "~/lib/class-path";
import { useLibrary } from "~/lib/queries/library";
import { cn } from "~/lib/utils";
import { classScopeKey, useLectureSelectionStore, useTickedLectures } from "~/stores/lecture-selection-store";

const FILTERS: { id: LectureFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "weak", label: "Weak" },
  { id: "due", label: "Due" },
];

/**
 * The lecture column (design "Lectures"): the class title and + Add files, the filter chips, the
 * Overview row and the lectures grouped by unit with a checkbox and a badge each. Ticked lectures
 * are the scope for Practice, Ask and Map.
 */
export function LectureColumn({
  root,
  course,
  rows,
  loading,
  examLabel,
  onOverview,
  activeDigest,
  onNavigate,
  inSheet = false,
  className,
}: {
  root: string | null;
  course: string;
  rows: UnitRows[];
  loading: boolean;
  /** "exam Nov 21" for the Overview row, when the class has an exam date. */
  examLabel: string | null;
  onOverview: boolean;
  /** Course-prefixed digest path of the lecture open in Read. */
  activeDigest: string | null;
  /** Called after a navigation, so the narrow-window sheet can close. */
  onNavigate?: () => void;
  /** In the narrow-window sheet, whose Close button sits over the header's right edge. */
  inSheet?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();
  // The filter belongs to one class: opening another class (the column stays mounted) starts at All.
  const filterScope = `${root ?? ""}::${course}`;
  const [filterState, setFilterState] = useState<{ scope: string; filter: LectureFilter }>({
    scope: filterScope,
    filter: "all",
  });
  if (filterState.scope !== filterScope) {
    setFilterState({ scope: filterScope, filter: "all" });
  }
  const filter = filterState.scope === filterScope ? filterState.filter : "all";
  const setFilter = (next: LectureFilter) => setFilterState({ scope: filterScope, filter: next });
  const ticked = useTickedLectures(root, course);
  const toggle = useLectureSelectionStore((s) => s.toggle);
  const library = useLibrary(root);
  const role = library.data?.present === true ? library.data.role : null;
  const viewerBlocked = viewerBlocksWrite(role);
  const { addFiles, busy } = useAddFiles(root, course);

  const counts = countLectures(rows);
  const shown = filterLectures(rows, filter);
  const scopeKey = root ? classScopeKey(root, course) : null;

  return (
    <nav
      aria-label="Lectures"
      className={cn(
        "flex h-full min-h-0 w-85 shrink-0 flex-col overflow-y-auto border-r border-border bg-background",
        className,
      )}
    >
      <div
        data-testid="lecture-column-header"
        className={cn("flex flex-col gap-2.5 px-3.5 pb-2.5 pt-4", inSheet && "pr-12")}
      >
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-title text-foreground">{courseDisplayName(course)}</h1>
          <button
            type="button"
            disabled={busy || viewerBlocked || !root}
            title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
            onClick={() => void addFiles()}
            className="inline-flex h-control shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-small text-foreground transition-colors duration-fast ease-out-soft hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-icon-sm animate-spin" aria-hidden /> : null}
            <span>{"+ Add files"}</span>
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter lectures">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={cn(
                "inline-flex h-6 items-center rounded-full border px-2.5 text-caption transition-colors duration-fast ease-out-soft",
                filter === id
                  ? "border-transparent bg-accent text-accent-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {`${label} ${counts[id]}`}
            </button>
          ))}
        </div>
      </div>

      <p className="px-3.5 pb-0.5 pt-2 text-label text-faint-foreground">Overview</p>
      <button
        type="button"
        aria-current={onOverview ? "page" : undefined}
        onClick={() => {
          void navigate({ ...classPath(course, "overview"), search: {} });
          onNavigate?.();
        }}
        className={cn(
          "flex w-full items-center gap-2.5 border-b border-border px-3.5 py-2 text-left text-small text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-muted",
          onOverview && "bg-selected text-foreground",
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {examLabel ? `Course map · study plan · ${examLabel}` : "Course map · study plan"}
        </span>
        <span aria-hidden className="text-faint-foreground">
          ›
        </span>
      </button>

      {loading ? (
        <div className="flex flex-col gap-1 px-3.5 pt-3">
          <Skeleton className="h-row w-full" />
          <Skeleton className="h-row w-full" />
          <Skeleton className="h-row w-full" />
        </div>
      ) : (
        shown.map((group) => (
          <section key={group.unit} aria-label={group.unit}>
            <h2
              data-testid="lecture-unit"
              className="px-3.5 pb-0.5 pt-3 text-label text-faint-foreground"
            >
              {group.unit}
            </h2>
            {group.lectures.map((lecture) => {
              const active = lecture.digest === activeDigest;
              const isTicked = ticked.includes(lecture.digest);
              return (
                <div
                  key={lecture.digest}
                  data-testid="lecture-row"
                  className={cn(
                    "flex items-center gap-2.5 border-b border-border px-3.5 py-2 transition-colors duration-fast ease-out-soft hover:bg-muted",
                    active && "bg-selected",
                  )}
                >
                  <Checkbox
                    aria-label={`Select ${lecture.title}`}
                    checked={isTicked}
                    onCheckedChange={() => {
                      if (scopeKey) {
                        toggle(scopeKey, lecture.digest);
                      }
                    }}
                  />
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      void navigate({
                        ...classPath(course, "read", digestSlugFromPath(lecture.digest)),
                        search: {},
                      });
                      onNavigate?.();
                    }}
                    className={cn(
                      "min-w-0 flex-1 truncate text-left text-small text-foreground",
                      active && "font-semibold",
                    )}
                  >
                    {lecture.title}
                  </button>
                  <LectureBadge lecture={lecture} />
                </div>
              );
            })}
          </section>
        ))
      )}
    </nav>
  );
}

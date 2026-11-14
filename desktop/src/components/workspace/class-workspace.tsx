import { Outlet, useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { ListCollapse } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AskCourseSelect, ChatsColumn, ShowChatsButton } from "~/components/chat/chats-column";
import { formatExamDate } from "~/components/today/today-model";
import { ClassHeader } from "~/components/workspace/class-header";
import { ClassTabs } from "~/components/workspace/class-tabs";
import { LectureColumn } from "~/components/workspace/lecture-column";
import { PreviewBarSlotContext } from "~/components/workspace/preview-bar";
import { SelectionTray } from "~/components/workspace/selection-tray";
import { useExamDate } from "~/components/workspace/use-exam-date";
import { useLectureRows } from "~/components/workspace/use-lecture-rows";
import {
  pickReadTarget,
  showsLectureColumn,
  workspaceLocation,
} from "~/components/workspace/workspace-mode";
import { IconButton } from "~/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "~/components/ui/sheet";
import { scopeLabel, toCourseDigest } from "~/domain/lectures";
import { digestSlugFromPath } from "~/domain/notes";
import { useNotesMainNarrow } from "~/hooks/use-notes-main-narrow";
import { lecturesFromSearch } from "~/lib/class-path";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useSettings } from "~/lib/queries/settings";
import { classScopeKey, useLectureSelectionStore, useTickedLectures } from "~/stores/lecture-selection-store";
import { cn } from "~/lib/utils";

/**
 * Below this workspace width the lecture column becomes a sheet. The column is 340 px; in Read at
 * 960 the reading pane keeps about 540 px of text (704 left 368 px at a 1024 px window). Overview
 * and Map have no reading measure to protect, so they keep the column down to 704.
 */
const READ_SHEET_BELOW_PX = 960;
const SHEET_BELOW_PX = 704;

/**
 * The class workspace every `/course/$course/*` view renders in: the lecture column (Overview,
 * Read, Map), a full-width class header (Practice), the bar of Read / Practice / Map / Ask
 * tabs, and the selection tray. Ask puts the Chats list where the lecture column stands and the
 * class header (title, tabs, Course select) in the pane beside it. The views themselves are the
 * Outlet.
 */
export function ClassWorkspace({ course }: { course: string }) {
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const location = workspaceLocation(pathname);
  const { lectures: lecturesParam } = useSearch({ strict: false }) as { lectures?: string };
  const navigate = useNavigate();

  const { rows, reading, loading } = useLectureRows(activeRoot, course);
  const storedTicked = useTickedLectures(activeRoot, course);
  const setScope = useLectureSelectionStore((s) => s.setScope);
  const clear = useLectureSelectionStore((s) => s.clear);
  const examDate = useExamDate(activeRoot, course);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const narrow = useNotesMainNarrow(wrapperRef, location.mode === "read" ? READ_SHEET_BELOW_PX : SHEET_BELOW_PX);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [barSlot, setBarSlot] = useState<HTMLElement | null>(null);

  // A Drill or Today link carries its lectures in `?lectures=`; they become the ticked scope.
  // Only lectures that are rows of the class are kept, so the rows are needed first.
  useEffect(() => {
    if (activeRoot && lecturesParam && !loading) {
      const known = new Set(rows.flatMap((group) => group.lectures.map((lecture) => lecture.digest)));
      // `?lectures=` may carry `digests/x.md`; the store holds the course-prefixed form (Q17).
      const digests = lecturesParam
        .split(",")
        .flatMap((part) => {
          try {
            return lecturesFromSearch(part).map((path) => toCourseDigest(course, path));
          } catch {
            return []; // a hand-made link with a malformed % escape: ignore that entry
          }
        })
        .filter((digest) => known.has(digest));
      setScope(classScopeKey(activeRoot, course), digests);
      // Once stored the param leaves the URL (replacing the entry), so Back to it later does not
      // re-tick lectures the user has since cleared.
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({ ...prev, lectures: undefined }),
        replace: true,
      });
    }
  }, [activeRoot, course, lecturesParam, loading, rows, navigate, setScope]);

  const columnMode = showsLectureColumn(location.mode);
  const askMode = location.mode === "ask";
  if (!narrow && sheetOpen) {
    setSheetOpen(false);
  }

  const readTarget = pickReadTarget(rows, reading);
  const readSlug = location.digestSlug ?? (readTarget ? digestSlugFromPath(readTarget) : null);
  const activeDigest =
    location.mode === "read" && location.digestSlug
      ? (rows
          .flatMap((group) => group.lectures)
          .find((lecture) => digestSlugFromPath(lecture.digest) === location.digestSlug)?.digest ?? null)
      : null;
  // Only lectures that are rows of the class count: a ticked path no row shows could not be unticked.
  const ticked = useMemo(() => {
    if (loading) {
      return storedTicked;
    }
    const known = new Set(rows.flatMap((group) => group.lectures.map((lecture) => lecture.digest)));
    return storedTicked.filter((digest) => known.has(digest));
  }, [loading, rows, storedTicked]);
  const trayOpen = ticked.length > 0;
  const clearScope = () => {
    if (activeRoot) {
      clear(classScopeKey(activeRoot, course));
    }
  };

  const column = (extra?: { className?: string; onNavigate?: () => void; inSheet?: boolean }) => (
    <LectureColumn
      root={activeRoot}
      course={course}
      rows={rows}
      loading={loading}
      examLabel={examDate ? `exam ${formatExamDate(examDate)}` : null}
      onOverview={location.mode === "overview"}
      activeDigest={activeDigest}
      {...extra}
    />
  );

  return (
    <div
      ref={wrapperRef}
      data-testid="class-workspace"
      className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      {columnMode || askMode ? null : (
        <ClassHeader
          course={course}
          location={location}
          readSlug={readSlug}
          scope={scopeLabel(rows, ticked)}
          onClearScope={clearScope}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {columnMode && !narrow ? (
          <div className="flex min-h-0 shrink-0">{column({ className: trayOpen ? "pb-20" : undefined })}</div>
        ) : null}
        {askMode ? <ChatsColumn root={activeRoot} course={course} /> : null}
        <div
          data-testid="workspace-main"
          className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", trayOpen && "pb-20")}
        >
          {askMode ? (
            <ClassHeader
              course={course}
              location={location}
              readSlug={readSlug}
              scope={null}
              onClearScope={clearScope}
              leading={<ShowChatsButton />}
              trailing={<AskCourseSelect root={activeRoot} course={course} />}
            />
          ) : null}
          {columnMode ? (
            <div className="flex shrink-0 items-center gap-2 px-10 pt-4">
              {narrow ? (
                <IconButton
                  icon={ListCollapse}
                  label="Show lectures"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setSheetOpen(true)}
                />
              ) : null}
              <ClassTabs course={course} mode={location.mode} readSlug={readSlug} />
              <div className="flex-1" />
              <div
                ref={setBarSlot}
                data-testid="preview-bar-right"
                className="min-w-0 truncate text-caption text-muted-foreground"
              />
            </div>
          ) : null}
          <PreviewBarSlotContext.Provider value={barSlot}>
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              <Outlet />
            </div>
          </PreviewBarSlotContext.Provider>
        </div>
      </div>
      {/* The sheet is modal and drawn under the tray, so hide the tray while it is open. */}
      {narrow && columnMode && sheetOpen ? null : (
        <SelectionTray course={course} count={ticked.length} onClear={clearScope} />
      )}
      {narrow && columnMode ? (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="left" className="p-0 data-[side=left]:w-85">
            <SheetHeader className="sr-only">
              <SheetTitle>Lectures</SheetTitle>
              <SheetDescription>The lectures in this class.</SheetDescription>
            </SheetHeader>
            {column({ className: "w-full border-r-0", inSheet: true, onNavigate: () => setSheetOpen(false) })}
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { NotesIndex, NotesIndexShowButton } from "~/components/app/notes-index";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "~/components/ui/sheet";
import { useNotesMainNarrow } from "~/hooks/use-notes-main-narrow";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useDigests } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";
import { useUiStore } from "~/stores/ui-store";
import { cn } from "~/lib/utils";

export type NotesSearch = {
  heading?: string;
};

export const Route = createFileRoute("/course/$course/notes")({
  validateSearch: (search: Record<string, unknown>): NotesSearch => ({
    heading: typeof search.heading === "string" ? search.heading : undefined,
  }),
  component: NotesLayout,
});

function NotesLayout() {
  const { course } = Route.useParams();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const digests = useDigests(activeRoot, course);
  const notesIndexOpen = useUiStore((s) => s.notesIndexOpen);
  const setNotesIndexOpen = useUiStore((s) => s.setNotesIndexOpen);
  const mainRef = useRef<HTMLDivElement>(null);
  const narrow = useNotesMainNarrow(mainRef);
  const [indexSheetOpen, setIndexSheetOpen] = useState(false);

  const indexSheetVisible = narrow && indexSheetOpen;

  const showInlineIndex = !narrow && notesIndexOpen;
  const showIndexButton = narrow ? !indexSheetVisible : !notesIndexOpen;

  const hideIndex = () => {
    if (narrow) {
      setIndexSheetOpen(false);
    } else {
      setNotesIndexOpen(false);
    }
  };

  const showIndex = () => {
    if (narrow) {
      setIndexSheetOpen(true);
    } else {
      setNotesIndexOpen(true);
    }
  };

  return (
    <div
      ref={mainRef}
      className="@container/notes-main flex min-h-0 flex-1 overflow-hidden"
    >
      {showInlineIndex ? (
        <NotesIndex
          course={course}
          digests={digests.data}
          loading={digests.isLoading}
          onHideIndex={hideIndex}
        />
      ) : null}
      <div
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          !showInlineIndex && "items-stretch",
        )}
      >
        {showIndexButton ? <NotesIndexShowButton onClick={showIndex} /> : null}
        <Outlet />
      </div>
      {narrow ? (
        <Sheet
          open={indexSheetVisible}
          onOpenChange={(open) => {
            if (narrow) {
              setIndexSheetOpen(open);
            }
          }}
        >
          <SheetContent side="left" className="w-index p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Course index</SheetTitle>
              <SheetDescription>Digest list for this course.</SheetDescription>
            </SheetHeader>
            <NotesIndex
              course={course}
              digests={digests.data}
              loading={digests.isLoading}
              onHideIndex={hideIndex}
              className="h-full w-full border-r-0"
            />
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}

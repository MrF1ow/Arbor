import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

import { EmptyState } from "~/components/app/empty-state";
import { CourseOverview } from "~/components/notes/course-overview";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Spinner } from "~/components/ui/spinner";
import { classSearchFrom, type ClassSearch } from "~/lib/class-path";
import { openDialog } from "~/lib/ipc";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useDigests, useImportSourcesMutation } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";

export type OverviewSearch = ClassSearch & { heading?: string };

export const Route = createFileRoute("/course/$course/overview")({
  validateSearch: (search: Record<string, unknown>): OverviewSearch => ({
    ...classSearchFrom(search),
    heading: typeof search.heading === "string" ? search.heading : undefined,
  }),
  component: OverviewRoute,
});

// Thin route over the existing Overview view; the workspace rebuild replaces it.
function OverviewRoute() {
  const { course } = Route.useParams();
  const { heading } = Route.useSearch();
  const scrollRef = useRef<HTMLDivElement>(null);
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const digests = useDigests(activeRoot, course);
  const importSources = useImportSourcesMutation(activeRoot);

  const onAddFiles = async () => {
    if (!activeRoot) {
      return;
    }
    try {
      const picked = await openDialog({
        multiple: true,
        filters: [{ name: "Lecture files", extensions: ["pdf", "pptx", "docx"] }],
      });
      const paths = typeof picked === "string" ? [picked] : picked;
      if (!paths || paths.length === 0) {
        return;
      }
      await importSources.mutateAsync({ course, paths });
    } catch (error) {
      toast.error(String(error));
    }
  };

  if (digests.isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
        <Skeleton className="h-32 w-full max-w-lg" />
      </div>
    );
  }

  if (digests.isSuccess && digests.data.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState
          title="No digests yet"
          description="Add lecture files to generate study notes for this class."
          actions={
            <Button disabled={importSources.isPending} onClick={() => void onAddFiles()}>
              {importSources.isPending ? (
                <Spinner className="size-icon-sm" />
              ) : (
                <Plus className="size-icon-sm" />
              )}
              Add files
            </Button>
          }
        />
      </div>
    );
  }

  if (!digests.data) {
    return null;
  }

  return (
    <div
      ref={scrollRef}
      data-testid="overview-pane"
      className="notes-reading-pane min-h-0 flex-1 overflow-y-auto"
    >
      <CourseOverview
        key={`${activeRoot}|${course}`}
        course={course}
        digests={digests.data}
        heading={heading}
        scrollRef={scrollRef}
      />
    </div>
  );
}

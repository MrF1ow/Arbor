import { useParams, useSearch } from "@tanstack/react-router";

import { CourseOverview } from "~/components/notes/course-overview";
import { NoDigestsEmptyState } from "~/components/workspace/no-digests";
import { Skeleton } from "~/components/ui/skeleton";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useDigests } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";

/**
 * The body of the Overview route and of the old `notes/` route, so both import a component and
 * stay code-split; it reads its params without a fixed route.
 */
export function OverviewPage() {
  const { course } = useParams({ strict: false }) as { course: string };
  const { heading } = useSearch({ strict: false }) as { heading?: string };
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const digests = useDigests(activeRoot, course);

  if (digests.isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-10">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
        <Skeleton className="h-32 w-full max-w-lg" />
      </div>
    );
  }

  if (digests.isSuccess && digests.data.length === 0) {
    return <NoDigestsEmptyState root={activeRoot} course={course} />;
  }

  if (!digests.data) {
    return null;
  }

  return <CourseOverview key={`${activeRoot}|${course}`} course={course} digests={digests.data} heading={heading} />;
}

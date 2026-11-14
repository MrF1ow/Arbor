import { createFileRoute } from "@tanstack/react-router";

import { DigestView } from "~/components/notes/digest-view";
import { classSearchFrom, type ClassSearch } from "~/lib/class-path";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useDigests } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";

export type ReadSearch = ClassSearch & { heading?: string };

export const Route = createFileRoute("/course/$course/read/$digest")({
  validateSearch: (search: Record<string, unknown>): ReadSearch => ({
    ...classSearchFrom(search),
    heading: typeof search.heading === "string" ? search.heading : undefined,
  }),
  component: ReadRoute,
});

// Thin route over the existing digest view; the workspace rebuild replaces it.
function ReadRoute() {
  const { course, digest } = Route.useParams();
  const { heading } = Route.useSearch();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const digests = useDigests(activeRoot, course);

  return (
    <DigestView
      key={digest}
      course={course}
      digestSlug={digest}
      digests={digests.data ?? []}
      heading={heading}
    />
  );
}

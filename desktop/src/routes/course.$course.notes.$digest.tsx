import { createFileRoute } from "@tanstack/react-router";

import { DigestView } from "~/components/notes/digest-view";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useDigests } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";
import type { NotesSearch } from "~/routes/course.$course.notes";

export const Route = createFileRoute("/course/$course/notes/$digest")({
  validateSearch: (search: Record<string, unknown>): NotesSearch => ({
    heading: typeof search.heading === "string" ? search.heading : undefined,
  }),
  component: DigestRoute,
});

function DigestRoute() {
  const { course, digest } = Route.useParams();
  const { heading } = Route.useSearch();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const digests = useDigests(activeRoot, course);

  return (
    <DigestView
      course={course}
      digestSlug={digest}
      digests={digests.data ?? []}
      heading={heading}
    />
  );
}

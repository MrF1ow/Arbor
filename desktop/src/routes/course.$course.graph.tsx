import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { GraphView } from "~/components/graph/graph-view";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useDigests } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";

export type GraphSearch = {
  concept?: string;
};

export const Route = createFileRoute("/course/$course/graph")({
  validateSearch: (search: Record<string, unknown>): GraphSearch => ({
    concept: typeof search.concept === "string" ? search.concept : undefined,
  }),
  component: GraphRoute,
});

function GraphRoute() {
  const { course } = Route.useParams();
  const { concept } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const digests = useDigests(activeRoot, course);

  const onConceptParamSync = useCallback(
    (conceptId: string | undefined) => {
      void navigate({
        search: (prev) => ({ ...prev, concept: conceptId }),
        replace: true,
      });
    },
    [navigate],
  );

  return (
    <GraphView
      key={`${activeRoot ?? ""}|${course}`}
      course={course}
      digests={digests.data ?? []}
      conceptParam={concept}
      onConceptParamSync={onConceptParamSync}
    />
  );
}

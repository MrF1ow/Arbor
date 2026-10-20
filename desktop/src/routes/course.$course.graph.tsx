import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "~/components/app/page-header";
import { courseDisplayName } from "~/domain/course";

export type GraphSearch = {
  concept?: string;
};

export const Route = createFileRoute("/course/$course/graph")({
  validateSearch: (search: Record<string, unknown>): GraphSearch => ({
    concept: typeof search.concept === "string" ? search.concept : undefined,
  }),
  component: GraphPlaceholder,
});

function GraphPlaceholder() {
  const { course } = Route.useParams();
  return (
    <div className="p-8">
      <PageHeader title={`${courseDisplayName(course)} graph`} description="Graph arrives in PR 10." />
    </div>
  );
}

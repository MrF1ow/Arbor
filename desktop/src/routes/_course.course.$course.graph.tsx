import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "~/components/app/page-header";
import { courseDisplayName } from "~/domain/course";

export const Route = createFileRoute("/_course/course/$course/graph")({
  component: GraphPlaceholder,
});

function GraphPlaceholder() {
  const { course } = Route.useParams();
  return (
    <div className="p-8">
      <PageHeader title={`${courseDisplayName(course)} graph`} description="Concept graph arrives in PR 10." />
    </div>
  );
}

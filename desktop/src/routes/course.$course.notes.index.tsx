import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "~/components/app/page-header";
import { courseDisplayName } from "~/domain/course";

export const Route = createFileRoute("/course/$course/notes/")({
  component: CourseOverviewPlaceholder,
});

function CourseOverviewPlaceholder() {
  const { course } = Route.useParams();
  return (
    <div className="p-8">
      <PageHeader
        title={courseDisplayName(course)}
        description="Overview arrives in PR 7."
      />
    </div>
  );
}

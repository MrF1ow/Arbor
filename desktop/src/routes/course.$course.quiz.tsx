import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "~/components/app/page-header";
import { courseDisplayName } from "~/domain/course";

export const Route = createFileRoute("/course/$course/quiz")({
  component: QuizPlaceholder,
});

function QuizPlaceholder() {
  const { course } = Route.useParams();
  return (
    <div className="p-8">
      <PageHeader title={`${courseDisplayName(course)} quiz`} description="Quiz arrives in PR 9." />
    </div>
  );
}

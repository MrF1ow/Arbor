import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "~/components/app/page-header";
import { courseDisplayName } from "~/domain/course";

export const Route = createFileRoute("/course/$course/flashcards")({
  component: FlashcardsPlaceholder,
});

function FlashcardsPlaceholder() {
  const { course } = Route.useParams();
  return (
    <div className="p-8">
      <PageHeader title={`${courseDisplayName(course)} flashcards`} description="Flashcards arrive in PR 8." />
    </div>
  );
}

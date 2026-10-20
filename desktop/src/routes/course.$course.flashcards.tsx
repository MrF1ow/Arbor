import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "~/components/app/page-header";
import { courseDisplayName } from "~/domain/course";

export type FlashcardsSearch = {
  card?: string;
};

export const Route = createFileRoute("/course/$course/flashcards")({
  validateSearch: (search: Record<string, unknown>): FlashcardsSearch => ({
    card: typeof search.card === "string" ? search.card : undefined,
  }),
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

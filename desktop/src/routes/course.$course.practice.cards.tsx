import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { FlashcardsView } from "~/components/flashcards/flashcards-view";
import { classSearchFrom, type ClassSearch } from "~/lib/class-path";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useDigests } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";

export type CardsSearch = ClassSearch & { card?: string };

export const Route = createFileRoute("/course/$course/practice/cards")({
  validateSearch: (search: Record<string, unknown>): CardsSearch => ({
    ...classSearchFrom(search),
    card: typeof search.card === "string" ? search.card : undefined,
  }),
  component: CardsRoute,
});

// Thin route over the existing flashcards view; the Practice rebuild replaces it.
function CardsRoute() {
  const { course } = Route.useParams();
  const { card } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const digests = useDigests(activeRoot, course);

  const onFocusCardHandled = useCallback(() => {
    void navigate({
      search: (prev) => ({ ...prev, card: undefined }),
      replace: true,
    });
  }, [navigate]);

  return (
    <FlashcardsView
      key={`${activeRoot ?? ""}|${course}`}
      course={course}
      digests={digests.data ?? []}
      focusCardId={card}
      onFocusCardHandled={onFocusCardHandled}
    />
  );
}

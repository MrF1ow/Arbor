import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { FlashcardsView } from "~/components/flashcards/flashcards-view";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useDigests } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";

export type FlashcardsSearch = {
  card?: string;
};

export const Route = createFileRoute("/course/$course/flashcards")({
  validateSearch: (search: Record<string, unknown>): FlashcardsSearch => ({
    card: typeof search.card === "string" ? search.card : undefined,
  }),
  component: FlashcardsRoute,
});

function FlashcardsRoute() {
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

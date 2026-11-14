import { createFileRoute } from "@tanstack/react-router";

import { OverviewPage } from "~/components/notes/overview-page";
import type { NotesSearch } from "~/routes/course.$course.notes";

export const Route = createFileRoute("/course/$course/notes/")({
  validateSearch: (search: Record<string, unknown>): NotesSearch => ({
    heading: typeof search.heading === "string" ? search.heading : undefined,
  }),
  component: OverviewPage,
});

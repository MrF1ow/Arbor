import { createFileRoute } from "@tanstack/react-router";

import { ReadPage } from "~/components/notes/read-page";
import type { NotesSearch } from "~/routes/course.$course.notes";

export const Route = createFileRoute("/course/$course/notes/$digest")({
  validateSearch: (search: Record<string, unknown>): NotesSearch => ({
    heading: typeof search.heading === "string" ? search.heading : undefined,
  }),
  component: ReadPage,
});

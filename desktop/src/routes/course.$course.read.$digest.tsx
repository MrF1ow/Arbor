import { createFileRoute } from "@tanstack/react-router";

import { ReadPage } from "~/components/notes/read-page";
import { classSearchFrom, type ClassSearch } from "~/lib/class-path";

export type ReadSearch = ClassSearch & { heading?: string };

export const Route = createFileRoute("/course/$course/read/$digest")({
  validateSearch: (search: Record<string, unknown>): ReadSearch => ({
    ...classSearchFrom(search),
    heading: typeof search.heading === "string" ? search.heading : undefined,
  }),
  component: ReadPage,
});

import { createFileRoute } from "@tanstack/react-router";

import { OverviewPage } from "~/components/notes/overview-page";
import { classSearchFrom, type ClassSearch } from "~/lib/class-path";

export type OverviewSearch = ClassSearch & { heading?: string };

export const Route = createFileRoute("/course/$course/overview")({
  validateSearch: (search: Record<string, unknown>): OverviewSearch => ({
    ...classSearchFrom(search),
    heading: typeof search.heading === "string" ? search.heading : undefined,
  }),
  component: OverviewPage,
});

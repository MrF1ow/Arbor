import { createFileRoute, Outlet } from "@tanstack/react-router";

export type NotesSearch = {
  heading?: string;
};

/** The old Notes path. Its views render in the class workspace like the new routes; P10 deletes it. */
export const Route = createFileRoute("/course/$course/notes")({
  validateSearch: (search: Record<string, unknown>): NotesSearch => ({
    heading: typeof search.heading === "string" ? search.heading : undefined,
  }),
  component: Outlet,
});

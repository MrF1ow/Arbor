import { createFileRoute, redirect } from "@tanstack/react-router";

import { classPath } from "~/lib/class-path";

/** A class opens on its Overview (Q4). Only this route redirects; the old paths stay as they are. */
export const Route = createFileRoute("/course/$course/")({
  beforeLoad: ({ params }) => {
    throw redirect({ ...classPath(params.course, "overview"), replace: true });
  },
});

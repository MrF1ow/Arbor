import { createFileRoute } from "@tanstack/react-router";

import { FirstRun } from "~/components/today/first-run";

type WelcomeSearch = {
  addClass?: boolean;
  root?: string;
};

export const Route = createFileRoute("/welcome")({
  validateSearch: (search: Record<string, unknown>): WelcomeSearch => ({
    addClass: search.addClass === true || search.addClass === "true" || search.addClass === "1",
    root: typeof search.root === "string" ? search.root : undefined,
  }),
  component: WelcomePage,
});

/** First run at its own URL: where choosing a folder lands to add the first class. */
function WelcomePage() {
  const { addClass, root } = Route.useSearch();
  return <FirstRun addClass={addClass} root={root} />;
}

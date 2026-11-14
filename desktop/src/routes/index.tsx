import { createFileRoute } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

import { EmptyState } from "~/components/app/empty-state";
import { FirstRun } from "~/components/today/first-run";
import { TodayPage } from "~/components/today/today-page";
import { Button } from "~/components/ui/button";
import { hasAnyKnowledgeRoot } from "~/lib/knowledge-root";
import { useSettings } from "~/lib/queries/settings";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

/** Today across every library, or First run until a library exists (Q7). */
function IndexPage() {
  const settings = useSettings();
  if (settings.isPending && settings.fetchStatus !== "idle") {
    return <div className="min-h-0 flex-1" />;
  }
  // Unreadable settings are not "no library": First run would invite choosing a folder over them.
  if (settings.isError) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <div role="alert">
          <EmptyState
            icon={TriangleAlert}
            title="Arbor could not read its settings"
            description={String(settings.error)}
            actions={
              <Button variant="outline" size="sm" onClick={() => void settings.refetch()}>
                Retry
              </Button>
            }
          />
        </div>
      </div>
    );
  }
  return hasAnyKnowledgeRoot(settings.data) ? <TodayPage /> : <FirstRun />;
}

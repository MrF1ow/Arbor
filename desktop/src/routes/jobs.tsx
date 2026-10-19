import { createFileRoute } from "@tanstack/react-router";
import { Activity } from "lucide-react";

import { EmptyState } from "~/components/app/empty-state";
import { PageHeader } from "~/components/app/page-header";

export const Route = createFileRoute("/jobs")({
  component: JobsPage,
});

function JobsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6">
      <PageHeader title="Jobs" description="Job history and controls arrive in a later PR." />
      <EmptyState icon={Activity} title="Jobs placeholder" description="Use the log drawer for live output." />
    </div>
  );
}

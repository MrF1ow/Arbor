import { createFileRoute } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";

import { EmptyState } from "~/components/app/empty-state";
import { ShellPageHeader } from "~/components/app/shell-page-header";

export const Route = createFileRoute("/settings/")({
  component: SettingsIndexPage,
});

function SettingsIndexPage() {
  return (
    <div className="space-y-6">
      <ShellPageHeader title="Settings" description="Settings screens ship in PR 14." />
      <EmptyState icon={Settings2} title="Settings placeholder" />
    </div>
  );
}

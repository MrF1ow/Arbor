import { createFileRoute } from "@tanstack/react-router";

import { SettingsWorkersPanel } from "~/components/settings/settings-workers-panel";

export const Route = createFileRoute("/settings/workers")({
  component: SettingsWorkersPage,
});

function SettingsWorkersPage() {
  return <SettingsWorkersPanel />;
}

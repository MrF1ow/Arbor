import { createFileRoute } from "@tanstack/react-router";

import { SettingsPlaceholder } from "~/components/settings/settings-placeholder";

export const Route = createFileRoute("/settings/workers")({
  component: SettingsWorkersPage,
});

function SettingsWorkersPage() {
  return <SettingsPlaceholder />;
}

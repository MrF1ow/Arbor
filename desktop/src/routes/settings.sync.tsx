import { createFileRoute } from "@tanstack/react-router";

import { SettingsPlaceholder } from "~/components/settings/settings-placeholder";

export const Route = createFileRoute("/settings/sync")({
  component: SettingsSyncPage,
});

function SettingsSyncPage() {
  return <SettingsPlaceholder />;
}

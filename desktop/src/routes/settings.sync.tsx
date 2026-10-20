import { createFileRoute } from "@tanstack/react-router";

import { SettingsSyncPanel } from "~/components/settings/settings-sync-panel";

export const Route = createFileRoute("/settings/sync")({
  component: SettingsSyncPage,
});

function SettingsSyncPage() {
  return <SettingsSyncPanel />;
}

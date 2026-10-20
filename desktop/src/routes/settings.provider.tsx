import { createFileRoute } from "@tanstack/react-router";

import { SettingsProviderPanel } from "~/components/settings/settings-provider-panel";

export const Route = createFileRoute("/settings/provider")({
  component: SettingsProviderPage,
});

function SettingsProviderPage() {
  return <SettingsProviderPanel />;
}

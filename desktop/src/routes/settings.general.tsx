import { createFileRoute } from "@tanstack/react-router";

import { SettingsGeneralPanel } from "~/components/settings/settings-general-panel";

export const Route = createFileRoute("/settings/general")({
  component: SettingsGeneralPage,
});

function SettingsGeneralPage() {
  return <SettingsGeneralPanel />;
}

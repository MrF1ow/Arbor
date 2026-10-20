import { createFileRoute } from "@tanstack/react-router";

import { SettingsShortcutsPanel } from "~/components/settings/settings-shortcuts-panel";

export const Route = createFileRoute("/settings/shortcuts")({
  component: SettingsShortcutsPage,
});

function SettingsShortcutsPage() {
  return <SettingsShortcutsPanel />;
}

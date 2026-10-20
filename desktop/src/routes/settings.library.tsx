import { createFileRoute } from "@tanstack/react-router";

import { SettingsLibraryPanel } from "~/components/settings/settings-library-panel";

export const Route = createFileRoute("/settings/library")({
  component: SettingsLibraryPage,
});

function SettingsLibraryPage() {
  return <SettingsLibraryPanel />;
}

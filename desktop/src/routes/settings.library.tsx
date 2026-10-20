import { createFileRoute } from "@tanstack/react-router";

import { SettingsPlaceholder } from "~/components/settings/settings-placeholder";

export const Route = createFileRoute("/settings/library")({
  component: SettingsLibraryPage,
});

function SettingsLibraryPage() {
  return <SettingsPlaceholder />;
}

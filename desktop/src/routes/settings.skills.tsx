import { createFileRoute } from "@tanstack/react-router";

import { SettingsPlaceholder } from "~/components/settings/settings-placeholder";

export const Route = createFileRoute("/settings/skills")({
  component: SettingsSkillsPage,
});

function SettingsSkillsPage() {
  return <SettingsPlaceholder />;
}

import { createFileRoute } from "@tanstack/react-router";

import { SettingsSkillsPanel } from "~/components/settings/settings-skills-panel";

export const Route = createFileRoute("/settings/skills")({
  component: SettingsSkillsPage,
});

function SettingsSkillsPage() {
  return <SettingsSkillsPanel />;
}

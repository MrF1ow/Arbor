import { EmptyState } from "~/components/app/empty-state";
import { Settings2 } from "lucide-react";

export function SettingsPlaceholder() {
  return (
    <EmptyState
      icon={Settings2}
      title="Coming in the next PR"
      description="Library, sync, skills, and workers settings ship in PR 14b."
    />
  );
}

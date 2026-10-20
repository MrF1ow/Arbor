import { EmptyState } from "~/components/app/empty-state";
import { Settings2 } from "lucide-react";

export function SettingsPlaceholder() {
  return (
    <EmptyState
      icon={Settings2}
      title="Coming in the next PR"
      description="This section is coming soon."
    />
  );
}

import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { SettingsNav } from "~/components/settings/settings-nav";
import { ShellPageHeader } from "~/components/app/shell-page-header";

export const Route = createFileRoute("/settings")({
  beforeLoad: ({ location }) => {
    const normalized = location.pathname.replace(/\/$/, "") || "/";
    if (normalized === "/settings") {
      throw redirect({ to: "/settings/general" });
    }
  },
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-auto p-6"
      data-testid="settings-view"
    >
      <div className="mx-auto flex w-full max-w-4xl min-h-0 flex-1 flex-col gap-6">
        <ShellPageHeader
          title="Settings"
          description="Appearance, Knowledge folder behavior, provider, and model selection."
        />
        <div className="flex min-h-0 flex-1 flex-col gap-4 jobs:flex-row jobs:items-start">
          <SettingsNav />
          <div className="min-w-0 flex-1">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}

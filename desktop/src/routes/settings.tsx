import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { SettingsSectionSwitcher } from "~/components/settings/settings-nav";

export const Route = createFileRoute("/settings")({
  beforeLoad: ({ location }) => {
    const normalized = location.pathname.replace(/\/$/, "") || "/";
    if (normalized === "/settings") {
      throw redirect({ to: "/settings/general" });
    }
  },
  component: SettingsLayout,
});

/**
 * The settings pages; the nav lives in the sidebar, which swaps to settings mode under /settings.
 * With the sidebar closed an inline switcher keeps the sections reachable.
 */
function SettingsLayout() {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-auto px-6 py-8"
      data-testid="settings-view"
    >
      <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col gap-6">
        <SettingsSectionSwitcher />
        <Outlet />
      </div>
    </div>
  );
}

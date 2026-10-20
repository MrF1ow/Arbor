import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
      <Outlet />
    </div>
  );
}

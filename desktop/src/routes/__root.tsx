import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";

import { AppShell } from "~/components/app/app-shell";
import { ThemeProvider } from "~/components/app/theme-provider";
import { Toaster } from "~/components/ui/toast";
import { TooltipProvider } from "~/components/ui/tooltip";
import { AppearanceSync } from "~/lib/appearance-sync";
import { WorkerEventsBridge } from "~/lib/events";
import { EffectiveProviderSync } from "~/lib/queries/effective-provider";
import { StudyWritesProvider } from "~/lib/study-writes";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const bareShell = pathname === "/dev/ui";

  return (
    <ThemeProvider>
      <TooltipProvider>
        <StudyWritesProvider>
          <EffectiveProviderSync />
          <WorkerEventsBridge />
          <AppearanceSync />
          <div className="flex h-full min-h-svh flex-col">
            {bareShell ? <Outlet /> : <AppShell />}
          </div>
          <Toaster />
        </StudyWritesProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

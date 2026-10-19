import { createRootRoute, Outlet } from "@tanstack/react-router";

import { ThemeProvider } from "~/components/app/theme-provider";
import { Toaster } from "~/components/ui/toast";
import { TooltipProvider } from "~/components/ui/tooltip";
import { AppearanceSync } from "~/lib/appearance-sync";
import { WorkerEventsBridge } from "~/lib/events";
import { StudyWritesProvider } from "~/lib/study-writes";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <StudyWritesProvider>
          <WorkerEventsBridge />
          <AppearanceSync />
          <Outlet />
          <Toaster />
        </StudyWritesProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

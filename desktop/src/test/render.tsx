import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, type RenderOptions } from "@testing-library/react";
import { clearMocks } from "@tauri-apps/api/mocks";

import { AppearanceSync } from "~/lib/appearance-sync";
import { createAppQueryClient } from "~/lib/query-client";
import { getRouter } from "~/router";
import { StudyWritesProvider } from "~/lib/study-writes";
import { WorkerEventsBridge } from "~/lib/events";
import { ThemeProvider } from "~/components/app/theme-provider";
import { Toaster } from "~/components/ui/toast";
import { TooltipProvider } from "~/components/ui/tooltip";
import { qk } from "~/lib/queries/keys";
import type { Settings } from "~/domain/types";
import { fixtureSettings } from "~/test/fixtures/data";
import { installMockIpc } from "~/test/mock-ipc";
import type { createMockHandler } from "~/test/mock-handlers";
import { trackTestQueryClient } from "~/test/query-clients";

type FixtureOverrides = Parameters<typeof createMockHandler>[0];

export function renderWithProviders(
  ui: React.ReactElement,
  opts?: {
    route?: string;
    fixtures?: FixtureOverrides;
    minimal?: boolean;
    seedSettings?: Settings;
  } & Omit<RenderOptions, "wrapper">,
) {
  clearMocks();
  installMockIpc(opts?.fixtures);
  const queryClient = createAppQueryClient();
  trackTestQueryClient(queryClient);
  if (opts?.seedSettings ?? opts?.minimal) {
    queryClient.setQueryData(qk.settings(), opts?.seedSettings ?? fixtureSettings);
  }
  const history = createMemoryHistory({ initialEntries: [opts?.route ?? "/"] });
  const router = getRouter(history);

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <StudyWritesProvider>
            {opts?.minimal ? null : (
              <>
                <WorkerEventsBridge />
                <AppearanceSync />
              </>
            )}
            {children}
            <Toaster />
          </StudyWritesProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );

  const rendered = render(ui ?? <></>, { wrapper: Wrapper, ...opts });
  return {
    ...rendered,
    queryClient,
    router,
    Wrapper,
  };
}

export async function renderAppAtRoute(route: string, fixtures?: FixtureOverrides) {
  clearMocks();
  installMockIpc(fixtures);
  const queryClient = createAppQueryClient();
  trackTestQueryClient(queryClient);
  const history = createMemoryHistory({ initialEntries: [route] });
  const router = getRouter(history);
  await router.load();

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <StudyWritesProvider>
            <WorkerEventsBridge />
            <AppearanceSync />
            <RouterProvider router={router} />
            <Toaster />
          </StudyWritesProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, router, queryClient };
}

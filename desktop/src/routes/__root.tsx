import { createRootRoute, Outlet } from "@tanstack/react-router";

import { ThemeProvider } from "~/components/app/theme-provider";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <ThemeProvider>
      <Outlet />
    </ThemeProvider>
  );
}

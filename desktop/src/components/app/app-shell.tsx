import { Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppSidebar } from "~/components/app/app-sidebar";
import { JobFailureToast } from "~/components/app/job-failure-toast";
import { LogDrawer } from "~/components/app/log-drawer";
import { SearchPlaceholderDialog } from "~/components/app/search-placeholder-dialog";
import { ShellContextProvider } from "~/components/app/shell-context";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { useGlobalShortcuts } from "~/hooks/use-global-shortcuts";
import { useUiStore } from "~/stores/ui-store";

export function AppShell() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const sidebarTouched = useUiStore((s) => s.sidebarTouched);
  const markSidebarTouched = useUiStore((s) => s.markSidebarTouched);
  const [searchOpen, setSearchOpen] = useState(false);

  useGlobalShortcuts({ onSearch: () => setSearchOpen(true) });

  useEffect(() => {
    if (sidebarTouched) {
      return;
    }
    const width = window.innerWidth;
    if (width >= 768 && width < 1024) {
      setSidebarOpen(false);
    }
  }, [setSidebarOpen, sidebarTouched]);

  const onSidebarOpenChange = (open: boolean) => {
    markSidebarTouched();
    setSidebarOpen(open);
  };

  return (
    <SidebarProvider
      contained
      open={sidebarOpen}
      onOpenChange={onSidebarOpenChange}
      className="h-full min-h-0"
    >
      <AppSidebar />
      <SidebarInset className="flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ShellContextProvider value={{ onOpenSearch: () => setSearchOpen(true) }}>
            <Outlet />
          </ShellContextProvider>
          <LogDrawer />
        </div>
      </SidebarInset>
      <SearchPlaceholderDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <JobFailureToast />
    </SidebarProvider>
  );
}

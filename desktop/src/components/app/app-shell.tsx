import { Outlet } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

import { AppSidebar } from "~/components/app/app-sidebar";
import { JobFailureToast } from "~/components/app/job-failure-toast";
import { ShellContextProvider } from "~/components/app/shell-context";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { useGlobalShortcuts } from "~/hooks/use-global-shortcuts";
import { useIsMobile } from "~/hooks/use-mobile";
import { useEffectiveSidebarOpen, useUiStore } from "~/stores/ui-store";

const LogDrawer = lazy(() =>
  import("~/components/app/log-drawer").then((m) => ({ default: m.LogDrawer })),
);

const SearchPlaceholderDialog = lazy(() =>
  import("~/components/app/search-placeholder-dialog").then((m) => ({
    default: m.SearchPlaceholderDialog,
  })),
);

const UpdateReviewDialog = lazy(() =>
  import("~/components/app/update-review-dialog").then((m) => ({
    default: m.UpdateReviewDialog,
  })),
);

export function AppShell() {
  const isMobile = useIsMobile();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const desktopSidebarOpen = useEffectiveSidebarOpen();
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const markSidebarTouched = useUiStore((s) => s.markSidebarTouched);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMounted, setSearchMounted] = useState(false);

  const sidebarOpen = isMobile ? mobileSidebarOpen : desktopSidebarOpen;

  useEffect(() => {
    if (!isMobile) {
      // Clear overlay state when leaving the mobile breakpoint so narrowing again does not reopen it.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mobile overlay is not persisted desktop sidebar state
      setMobileSidebarOpen(false);
    }
  }, [isMobile]);

  useGlobalShortcuts({
    onSearch: () => {
      setSearchMounted(true);
      setSearchOpen(true);
    },
  });

  const onSidebarOpenChange = (open: boolean) => {
    if (isMobile) {
      setMobileSidebarOpen(open);
      return;
    }
    markSidebarTouched();
    setSidebarOpen(open);
  };

  const onSearchOpenChange = (open: boolean) => {
    if (open) {
      setSearchMounted(true);
    }
    setSearchOpen(open);
  };

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={onSidebarOpenChange}
      className="h-svh min-h-0 overflow-hidden"
    >
      <AppSidebar />
      <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ShellContextProvider
            value={{
              onOpenSearch: () => {
                setSearchMounted(true);
                setSearchOpen(true);
              },
            }}
          >
            <Outlet />
          </ShellContextProvider>
          <Suspense fallback={null}>
            <LogDrawer />
          </Suspense>
          <Suspense fallback={null}>
            <UpdateReviewDialog />
          </Suspense>
        </div>
      </SidebarInset>
      {searchMounted ? (
        <Suspense fallback={null}>
          <SearchPlaceholderDialog open={searchOpen} onOpenChange={onSearchOpenChange} />
        </Suspense>
      ) : null}
      <JobFailureToast />
    </SidebarProvider>
  );
}

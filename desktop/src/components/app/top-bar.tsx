import { useNavigate, useRouterState } from "@tanstack/react-router";

import markDark from "~/assets/arbor-mark-dark.png";
import markLight from "~/assets/arbor-mark.png";
import { LibraryStatusPill } from "~/components/app/library-status-pill";
import { SidebarHeaderTrigger } from "~/components/app/sidebar-header-trigger";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { isMacPlatform, modKeyLabel, modShortcut } from "~/lib/shortcuts";
import { cn } from "~/lib/utils";

/** The design's Command-K on a Mac, "Ctrl+K" elsewhere. */
function searchShortcutLabel(): string {
  return isMacPlatform() ? `${modKeyLabel()}K` : modShortcut("K");
}

/**
 * The 52 px top bar every screen shares: the Arbor mark, the search field that opens the
 * palette (also Mod+K), the library status pill and Settings.
 */
export function TopBar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const inSettings = pathname.startsWith("/settings");

  return (
    <header className="flex h-header shrink-0 items-center gap-2.5 border-b border-border bg-background px-3">
      <SidebarHeaderTrigger />
      <div className="flex min-w-0 shrink items-center gap-2 overflow-hidden md:w-53">
        <img src={markLight} alt="" className="size-5 shrink-0 dark:hidden" />
        <img src={markDark} alt="" className="hidden size-5 shrink-0 dark:block" />
        <span className="min-w-0 truncate text-heading">Arbor</span>
      </div>
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="Search notes, concepts, and cards in every class"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card py-1.5 pr-2.5 pl-3 text-left text-small text-muted-foreground outline-none transition-colors duration-fast ease-out-soft hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 truncate">Search notes, concepts, and cards in every class</span>
        <Kbd className="h-4.5 bg-background text-kbd">{searchShortcutLabel()}</Kbd>
      </button>
      <LibraryStatusPill />
      <Button
        type="button"
        variant="ghost"
        className={cn(
          "h-6.75 shrink-0 px-2.5 py-1 text-small font-normal",
          inSettings && "border-border bg-card text-foreground",
        )}
        aria-current={inSettings ? "page" : undefined}
        onClick={() => void navigate({ to: "/settings/general" })}
      >
        Settings
      </Button>
    </header>
  );
}

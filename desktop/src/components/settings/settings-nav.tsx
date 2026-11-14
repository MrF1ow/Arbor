import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { NavRow } from "~/components/app/nav-row";
import { SidebarContent, useSidebar } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";

export const SETTINGS_SECTIONS: { to: string; title: string }[] = [
  { to: "/settings/general", title: "General" },
  { to: "/settings/provider", title: "Provider & models" },
  { to: "/settings/library", title: "Library & sharing" },
  { to: "/settings/sync", title: "Sync" },
  { to: "/settings/skills", title: "Skills" },
  { to: "/settings/workers", title: "Workers" },
  { to: "/settings/shortcuts", title: "Shortcuts" },
];

/**
 * Settings mode of the sidebar: Back to library, then the seven settings pages. The class
 * sidebar swaps for this while the route is under /settings.
 */
export function SettingsNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { setOpen, isMobile } = useSidebar();
  const closeOnMobile = () => {
    if (isMobile) {
      setOpen(false);
    }
  };

  return (
    <SidebarContent className="gap-0.5 p-2">
      <button
        type="button"
        className="flex w-fit items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-small text-muted-foreground outline-none transition-colors duration-fast ease-out-soft hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          void navigate({ to: "/" });
          closeOnMobile();
        }}
      >
        <ArrowLeft aria-hidden className="size-icon-sm" />
        Back to library
      </button>
      <p className="px-2 pt-3 pb-1 text-label text-faint-foreground">Settings</p>
      <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
        {SETTINGS_SECTIONS.map(({ to, title }) => (
          <NavRow
            key={to}
            label={title}
            active={pathname === to || pathname.startsWith(`${to}/`)}
            onSelect={() => {
              void navigate({ to });
              closeOnMobile();
            }}
          />
        ))}
      </nav>
    </SidebarContent>
  );
}

/**
 * The same seven sections as a wrapping row at the top of the settings page. It renders only
 * while the sidebar is closed (the default under 1024 px, a sheet under 768 px), when the
 * sidebar's own settings nav is off-canvas.
 */
export function SettingsSectionSwitcher() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { open } = useSidebar();
  if (open) {
    return null;
  }
  return (
    <nav aria-label="Switch settings section" className="flex flex-wrap gap-1">
      {SETTINGS_SECTIONS.map(({ to, title }) => {
        const active = pathname === to || pathname.startsWith(`${to}/`);
        return (
          <button
            key={to}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => void navigate({ to })}
            className={cn(
              "rounded-md px-2.5 py-1 text-small outline-none transition-colors duration-fast ease-out-soft focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-selected font-semibold text-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {title}
          </button>
        );
      })}
    </nav>
  );
}

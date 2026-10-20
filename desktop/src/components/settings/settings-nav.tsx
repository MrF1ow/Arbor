import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Cpu,
  Keyboard,
  Puzzle,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";

import { ListRow } from "~/components/app/list-row";
import { cn } from "~/lib/utils";

const SECTIONS: { to: string; title: string; icon: LucideIcon }[] = [
  { to: "/settings/general", title: "General", icon: SlidersHorizontal },
  { to: "/settings/provider", title: "Provider & models", icon: Cpu },
  { to: "/settings/library", title: "Library & sharing", icon: Users },
  { to: "/settings/sync", title: "Sync", icon: RefreshCw },
  { to: "/settings/skills", title: "Skills", icon: Puzzle },
  { to: "/settings/workers", title: "Workers", icon: Server },
  { to: "/settings/shortcuts", title: "Shortcuts", icon: Keyboard },
];

export function SettingsNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  return (
    <nav
      className={cn(
        "flex shrink-0 gap-1 overflow-x-auto pb-1 jobs:flex-col jobs:overflow-x-visible jobs:pb-0 jobs:w-52",
      )}
      aria-label="Settings sections"
    >
      {SECTIONS.map(({ to, title, icon: Icon }) => {
        const active = pathname === to || pathname.startsWith(`${to}/`);
        return (
          <ListRow
            key={to}
            title={title}
            icon={Icon}
            active={active}
            className="min-w-max jobs:min-w-0"
            onSelect={() => void navigate({ to })}
          />
        );
      })}
    </nav>
  );
}

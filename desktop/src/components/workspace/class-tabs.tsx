import { Link } from "@tanstack/react-router";

import type { WorkspaceMode } from "~/components/workspace/workspace-mode";
import { classPath } from "~/lib/class-path";
import { cn } from "~/lib/utils";

const TAB_BASE =
  "inline-flex h-7 items-center rounded-md px-3 text-small transition-colors duration-fast ease-out-soft";
const TAB_ACTIVE = "bg-card font-semibold text-foreground shadow-card";
const TAB_IDLE = "text-muted-foreground hover:text-foreground";

/** The design's Mode tabs: Read, Practice, Map, Ask. None is lit on Overview. */
export function ClassTabs({
  course,
  mode,
  readSlug,
}: {
  course: string;
  mode: WorkspaceMode;
  /** The digest the Read tab opens; null when the class has no digests yet. */
  readSlug: string | null;
}) {
  const tab = (active: boolean) => cn(TAB_BASE, active ? TAB_ACTIVE : TAB_IDLE);
  return (
    <nav
      aria-label="Class views"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {readSlug ? (
        <Link
          {...classPath(course, "read", readSlug)}
          search={{}}
          aria-current={mode === "read" ? "page" : undefined}
          className={tab(mode === "read")}
        >
          Read
        </Link>
      ) : (
        <span className={cn(TAB_BASE, TAB_IDLE, "opacity-50")} title="Add lecture files to read them">
          Read
        </span>
      )}
      <Link
        {...classPath(course, "cards")}
        search={{}}
        aria-current={mode === "practice" ? "page" : undefined}
        className={tab(mode === "practice")}
      >
        Practice
      </Link>
      <Link
        {...classPath(course, "map")}
        search={{}}
        aria-current={mode === "map" ? "page" : undefined}
        className={tab(mode === "map")}
      >
        Map
      </Link>
      <Link
        {...classPath(course, "ask")}
        search={{}}
        aria-current={mode === "ask" ? "page" : undefined}
        className={tab(mode === "ask")}
      >
        Ask
      </Link>
    </nav>
  );
}

/** Practice's Cards / Quiz sub-tabs. */
export function PracticeTabs({ course, active }: { course: string; active: "cards" | "quiz" | null }) {
  const tab = (on: boolean) => cn(TAB_BASE, on ? TAB_ACTIVE : TAB_IDLE);
  return (
    <nav aria-label="Practice" className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5">
      <Link
        {...classPath(course, "cards")}
        search={{}}
        aria-current={active === "cards" ? "page" : undefined}
        className={tab(active === "cards")}
      >
        Cards
      </Link>
      <Link
        {...classPath(course, "quiz")}
        search={{}}
        aria-current={active === "quiz" ? "page" : undefined}
        className={tab(active === "quiz")}
      >
        Quiz
      </Link>
    </nav>
  );
}

import { useNavigate } from "@tanstack/react-router";

import { classPath, type ClassTab } from "~/lib/class-path";
import { cn } from "~/lib/utils";

const SECONDARY =
  "inline-flex h-7.25 shrink-0 items-center whitespace-nowrap rounded-lg border border-border bg-background px-2.5 text-small text-foreground transition-colors duration-fast ease-out-soft hover:bg-muted";

/**
 * The dark tray (645 × 45, 35 px above the bottom of the workspace, as in the design) under the lecture column and the view: "N lectures selected" and what to do with
 * them. The lectures stay ticked while the user moves between Practice, Ask and Map, so the tray
 * and the scope chip are how they get cleared.
 */
export function SelectionTray({
  course,
  count,
  onClear,
  className,
}: {
  course: string;
  count: number;
  onClear: () => void;
  className?: string;
}) {
  const navigate = useNavigate();
  if (count === 0) {
    return null;
  }
  const go = (tab: ClassTab) => () => {
    void navigate({ ...classPath(course, tab), search: {} });
  };
  return (
    <section
      aria-label="Selected lectures"
      className={cn(
        "absolute bottom-8.75 left-1/2 z-floating flex min-h-11.25 w-161.25 max-w-full -translate-x-1/2 flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl bg-surface-inverse p-2 pl-4 text-text-inverse shadow-popover",
        className,
      )}
    >
      <p className="mr-2 whitespace-nowrap text-small font-semibold">
        {count === 1 ? "1 lecture selected" : `${count} lectures selected`}
      </p>
      <button
        type="button"
        onClick={go("cards")}
        className="inline-flex h-7.25 shrink-0 items-center whitespace-nowrap rounded-lg bg-primary px-2.5 text-small font-semibold text-primary-foreground transition-colors duration-fast ease-out-soft hover:bg-primary-hover"
      >
        Flashcards
      </button>
      <button type="button" onClick={go("quiz")} className={SECONDARY}>
        Quiz me
      </button>
      <button type="button" onClick={go("ask")} className={SECONDARY}>
        Ask about these
      </button>
      <button type="button" onClick={go("map")} className={SECONDARY}>
        Show on map
      </button>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex h-7.25 shrink-0 items-center whitespace-nowrap rounded-lg px-2.5 text-small text-text-inverse opacity-60 transition-opacity duration-fast ease-out-soft hover:opacity-100"
      >
        Clear
      </button>
    </section>
  );
}

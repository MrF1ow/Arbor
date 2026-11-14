import { Link } from "@tanstack/react-router";

import { cn } from "~/lib/utils";

/**
 * One sidebar row (Components › Nav item): optional leading mark, label, optional count.
 * Today, classes and the settings pages all use it. The active row is the selected tone with a
 * semibold label.
 */
export function NavRow({
  label,
  count,
  leading,
  active = false,
  onSelect,
  to,
  className,
  children,
}: {
  label: string;
  count?: string | null;
  leading?: React.ReactNode;
  active?: boolean;
  onSelect?: () => void;
  /** Render a router link instead of a button (Today). */
  to?: "/";
  className?: string;
  /** Extra trailing controls (the class row's change-icon button). */
  children?: React.ReactNode;
}) {
  const rowClass = cn(
    "flex w-full items-center gap-2 rounded-md px-2 py-1.25 text-left text-small outline-none transition-colors duration-fast ease-out-soft focus-visible:ring-2 focus-visible:ring-ring",
    active ? "bg-selected font-semibold text-foreground" : "text-foreground hover:bg-muted",
    className,
  );
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? (
        <span
          className={cn(
            "text-micro font-semibold text-primary",
            children && "group-focus-within/nav-row:hidden group-hover/nav-row:hidden",
          )}
        >
          {count}
        </span>
      ) : null}
    </>
  );
  const current = active ? ("page" as const) : undefined;

  return (
    <div className="group/nav-row relative flex w-full items-center">
      {to ? (
        <Link to={to} aria-current={current} className={rowClass} onClick={onSelect}>
          {body}
        </Link>
      ) : (
        <button type="button" aria-current={current} onClick={onSelect} className={rowClass}>
          {body}
        </button>
      )}
      {children}
    </div>
  );
}

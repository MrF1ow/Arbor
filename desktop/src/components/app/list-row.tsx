import type { LucideIcon } from "lucide-react";

import { cn } from "~/lib/utils";

export type ListRowProps = {
  title: string;
  meta?: string;
  trailing?: React.ReactNode;
  icon?: LucideIcon;
  active?: boolean;
  twoLine?: boolean;
  onSelect?: () => void;
  href?: string;
  className?: string;
};

export function ListRow({
  title,
  meta,
  trailing,
  icon: Icon,
  active = false,
  twoLine = false,
  onSelect,
  href,
  className,
}: ListRowProps) {
  const content = (
    <>
      {Icon ? <Icon className={cn("size-icon-sm shrink-0", active && "text-primary")} aria-hidden /> : null}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", active && "text-foreground")}>{title}</span>
        {twoLine && meta ? (
          <span className="block truncate text-2xs text-faint-foreground">{meta}</span>
        ) : null}
      </span>
      {!twoLine && meta ? <span className="text-2xs text-faint-foreground">{meta}</span> : null}
      {trailing}
    </>
  );

  const rowClass = cn(
    "relative flex w-full items-center gap-2 px-2 text-left text-sm outline-none transition-colors duration-fast ease-out-soft",
    twoLine ? "min-h-row py-1.5" : "h-row",
    "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-transparent",
    active && "before:bg-primary bg-transparent",
    !active && "hover:bg-muted",
    className,
  );

  if (href) {
    return (
      <a href={href} className={rowClass} aria-current={active ? "page" : undefined}>
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={rowClass}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
    >
      {content}
    </button>
  );
}

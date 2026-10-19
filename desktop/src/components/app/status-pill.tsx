import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";

const VARIANTS = {
  idle: "bg-muted text-muted-foreground",
  running: "bg-accent text-accent-foreground",
  failed: "bg-destructive-surface text-destructive",
  success: "bg-accent text-accent-foreground",
} as const;

export function StatusPill({
  variant,
  label,
  className,
}: {
  variant: keyof typeof VARIANTS;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
        VARIANTS[variant],
        className,
      )}
    >
      {variant === "running" ? (
        <Spinner className="size-icon-sm" />
      ) : (
        <span
          className={cn(
            "size-1.5 rounded-full",
            variant === "failed" ? "bg-destructive" : "bg-primary",
          )}
          aria-hidden
        />
      )}
      {label}
    </span>
  );
}

export const StatPill = StatusPill;

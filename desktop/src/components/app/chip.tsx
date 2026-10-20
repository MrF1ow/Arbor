import { cn } from "~/lib/utils";

type ChipProps = {
  children: React.ReactNode;
  variant?: "default" | "plain" | "figure";
  onClick?: () => void;
  className?: string;
} & React.HTMLAttributes<HTMLElement>;

export function Chip({
  children,
  variant = "default",
  onClick,
  className,
  ...rest
}: ChipProps) {
  const classes = cn(
    "inline-flex h-6 items-center rounded-xs border px-2 text-xs transition-colors duration-fast ease-out-soft",
    variant === "plain"
      ? "border-border text-muted-foreground"
      : variant === "figure"
        ? "border-dashed border-border text-muted-foreground"
        : "border-border text-accent-foreground hover:bg-accent",
    onClick && "cursor-pointer",
    className,
  );

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} {...rest}>
        {children}
      </button>
    );
  }

  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}

import { cn } from "~/lib/utils";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-border px-1 font-mono text-2xs text-muted-foreground select-none",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="kbd-group" className={cn("inline-flex items-center gap-1", className)} {...props} />
  );
}

export { Kbd, KbdGroup };

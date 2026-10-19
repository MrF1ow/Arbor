import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

export function SectionLabel({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <span className="font-serif text-sm italic text-faint-foreground">{children}</span>
      {action}
    </div>
  );
}

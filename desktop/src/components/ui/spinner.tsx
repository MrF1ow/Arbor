import { Loader2Icon } from "lucide-react";

import { cn } from "~/lib/utils";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-icon animate-spin text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Spinner };

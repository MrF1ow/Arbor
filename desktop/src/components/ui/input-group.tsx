import { cn } from "~/lib/utils";

import { Input } from "~/components/ui/input";

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "flex h-control w-full min-w-0 items-center gap-2 rounded-sm border border-input bg-card px-2 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
        className,
      )}
      {...props}
    />
  );
}

function InputGroupAddon({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group-addon"
      className={cn("shrink-0 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function InputGroupInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn("h-auto border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0", className)}
      {...props}
    />
  );
}

export { InputGroup, InputGroupAddon, InputGroupInput };

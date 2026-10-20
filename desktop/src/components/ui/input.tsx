import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "~/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-control w-full min-w-0 rounded-sm border border-input bg-card px-2.5 text-sm text-foreground transition-colors duration-fast ease-out-soft outline-none placeholder:text-faint-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };

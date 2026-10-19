import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-sm text-sm font-medium whitespace-nowrap transition-colors duration-fast ease-out-soft outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-muted data-pressed:bg-selected [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-icon-sm",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-control min-w-control px-2",
        sm: "h-6 min-w-6 px-2 text-xs",
        lg: "h-control-lg min-w-control-lg px-3",
      },
      variant: {
        default: "bg-transparent hover:bg-muted",
        outline: "border border-border bg-card hover:bg-muted",
      },
    },
  },
);

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };

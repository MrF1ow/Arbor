import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

const badgeVariants = cva(
  "inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-full border border-transparent px-2 text-xs font-medium whitespace-nowrap transition-colors duration-fast ease-out-soft [&>svg]:pointer-events-none [&>svg:not([class*='size-'])]:size-icon-sm",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground",
        outline: "border-border bg-card text-foreground",
        success: "bg-accent text-success",
        destructive: "bg-destructive-surface text-destructive",
        info: "bg-muted text-info",
      },
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };

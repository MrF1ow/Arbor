import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props}
    />
  );
}

const tabsListVariants = cva("inline-flex w-fit items-center text-muted-foreground", {
  defaultVariants: {
    variant: "underline",
  },
  variants: {
    variant: {
      underline: "gap-1 border-b border-border bg-transparent",
      segmented: "gap-0 rounded-full border border-border bg-muted p-0.5",
    },
  },
});

function TabsList({
  className,
  variant = "underline",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn("group/tabs-list", tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-row items-center justify-center gap-1.5 px-2 text-sm font-medium whitespace-nowrap transition-colors duration-fast ease-out-soft outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-icon-sm [&_svg]:pointer-events-none [&_svg]:shrink-0",
        "group-data-[variant=underline]/tabs-list:border-b-2 group-data-[variant=underline]/tabs-list:border-transparent group-data-[variant=underline]/tabs-list:text-muted-foreground group-data-[variant=underline]/tabs-list:data-active:border-primary group-data-[variant=underline]/tabs-list:data-active:text-foreground group-data-[variant=underline]/tabs-list:data-active:[&_svg]:text-primary",
        "group-data-[variant=segmented]/tabs-list:rounded-full group-data-[variant=segmented]/tabs-list:px-3 group-data-[variant=segmented]/tabs-list:data-active:bg-card group-data-[variant=segmented]/tabs-list:data-active:text-foreground group-data-[variant=segmented]/tabs-list:data-active:shadow-card",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };

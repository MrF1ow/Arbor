import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import type * as React from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-transparent text-sm font-medium transition-colors duration-fast ease-out-soft outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    compoundVariants: [
      {
        class:
          "data-pressed:bg-primary-hover aria-pressed:bg-primary-hover",
        variant: "default",
      },
      {
        class:
          "data-pressed:bg-destructive-hover aria-pressed:bg-destructive-hover",
        variant: "destructive",
      },
      {
        class:
          "data-pressed:bg-selected data-pressed:text-foreground aria-pressed:bg-selected aria-pressed:text-foreground",
        variant: ["secondary", "outline", "ghost", "link"],
      },
      {
        class:
          "data-pressed:bg-selected aria-pressed:bg-selected",
        variant: "destructive-outline",
      },
    ],
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default:
          "h-control px-3 [&_svg:not([class*='size-'])]:size-icon",
        xs: "h-6 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-icon-sm",
        sm: "h-control gap-1 px-2.5 text-sm [&_svg:not([class*='size-'])]:size-icon-sm",
        lg: "h-control-lg px-4 text-base [&_svg:not([class*='size-'])]:size-icon",
        icon: "size-control [&_svg:not([class*='size-'])]:size-icon",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-icon-sm",
        "icon-sm": "size-control [&_svg:not([class*='size-'])]:size-icon-sm",
        "icon-lg": "size-control-lg [&_svg:not([class*='size-'])]:size-icon",
      },
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: "bg-secondary text-secondary-foreground hover:bg-muted",
        outline:
          "border-border bg-card text-foreground hover:bg-muted",
        ghost:
          "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
        "destructive-outline":
          "border-border bg-card text-destructive hover:bg-destructive-surface",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
  },
);

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;
type IconButtonSize = Extract<ButtonSize, "icon-xs" | "icon-sm" | "icon" | "icon-lg">;

interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    "data-slot": "button",
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

type IconButtonProps = Omit<ButtonProps, "size" | "children"> & {
  icon: LucideIcon;
  label: string;
  size?: IconButtonSize;
  tooltip?: boolean;
};

function IconButton({
  icon: Icon,
  label,
  size = "icon",
  variant,
  tooltip = true,
  className,
  ...props
}: IconButtonProps) {
  const trigger = (
    <Button
      variant={variant}
      size={size}
      className={className}
      aria-label={label}
      {...props}
    >
      <Icon />
    </Button>
  );

  if (!tooltip) {
    return trigger;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export { Button, buttonVariants, IconButton, type ButtonSize, type ButtonVariant };

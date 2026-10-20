import * as React from "react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";

import { IconButton } from "~/components/ui/button";
import {
  SHEET_BACKDROP_CLASS,
  SHEET_POPUP_SIDE_CLASS,
} from "~/components/ui/dialog-styles";
import { cn } from "~/lib/utils";
import { XIcon } from "lucide-react";

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(SHEET_BACKDROP_CLASS, className)}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          SHEET_POPUP_SIDE_CLASS,
          "data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:border-t",
          "data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-index data-[side=left]:border-r",
          "data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-index data-[side=right]:border-l",
          "data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:border-b",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <SheetPrimitive.Close
            className="absolute top-3 right-3"
            render={
              <IconButton icon={XIcon} label="Close" size="icon-sm" variant="ghost" tooltip={false} />
            }
          />
        ) : null}
      </SheetPrimitive.Popup>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sheet-header" className={cn("flex flex-col gap-1 border-b border-border p-4", className)} {...props} />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sheet-footer" className={cn("mt-auto flex flex-col gap-2 border-t border-border p-4", className)} {...props} />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-serif text-xl font-medium text-foreground", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};

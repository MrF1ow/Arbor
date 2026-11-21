import { ChevronLeft, ChevronRight } from "lucide-react"
import * as React from "react"
import { DayPicker } from "react-day-picker"

import { buttonVariants } from "~/components/ui/button"
import { cn } from "~/lib/utils"

type CalendarProps = React.ComponentProps<typeof DayPicker>

/** react-day-picker styled with Arbor's theme tokens (no stylesheet import, no arbitrary values). */
function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  const navButton = cn(
    buttonVariants({ variant: "ghost", size: "icon-sm" }),
    "text-muted-foreground aria-disabled:opacity-50",
  )
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-1", className)}
      classNames={{
        root: "w-fit text-sm text-foreground",
        months: "relative flex flex-col gap-4",
        month: "flex flex-col gap-2",
        month_caption: "flex h-control items-center justify-center",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-0 top-0 flex h-control items-center justify-between",
        button_previous: navButton,
        button_next: navButton,
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-control text-center text-caption font-normal text-muted-foreground",
        week: "mt-1 flex w-full",
        day: "relative size-control p-0 text-center text-sm",
        day_button: cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "font-normal text-foreground",
        ),
        selected:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button:hover]:bg-primary-hover [&>button:hover]:text-primary-foreground",
        today: "[&>button]:border-border [&>button]:font-medium",
        outside: "[&>button]:text-muted-foreground [&>button]:opacity-50",
        disabled: "[&>button]:pointer-events-none [&>button]:opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("size-icon", chevronClass)} />
          ) : (
            <ChevronRight className={cn("size-icon", chevronClass)} />
          ),
      }}
      {...props}
    />
  )
}

export { Calendar }
export type { CalendarProps }

import { useState } from "react";

import { Button, IconButton } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
  COURSE_COLORS,
  COURSE_ICONS,
  courseIconKey,
  type CourseMetaMap,
} from "~/domain/course-icons";
import { VIEWER_WRITE_REASON, viewerBlocksWrite, type LibraryRole } from "~/domain/library-role";
import { useSetCourseMeta } from "~/lib/queries/course-meta";
import { cn } from "~/lib/utils";

export function CourseIconPicker({
  root,
  course,
  meta,
  role,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  root: string;
  course: string;
  meta: CourseMetaMap | undefined;
  role: LibraryRole | null;
  trigger: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const onOpenChange = controlledOnOpenChange ?? setInternalOpen;
  const setMeta = useSetCourseMeta(root);
  const viewerBlocked = viewerBlocksWrite(role);
  const entry = meta?.[course];
  const selectedIcon = courseIconKey(meta, course);
  const selectedColor = entry?.color ?? null;
  const storedIcon = entry?.icon ?? null;

  const apply = (icon: string | null, color: string | null) => {
    void setMeta.mutateAsync({ course, icon, color });
  };

  const onPickIcon = (key: string) => {
    apply(key, selectedColor);
  };

  const onPickColor = (key: string) => {
    apply(storedIcon, key);
  };

  const onReset = () => {
    apply(null, null);
    onOpenChange(false);
  };

  if (viewerBlocked) {
    return (
      <span className="inline-flex" title={VIEWER_WRITE_REASON}>
        {trigger}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger as React.ReactElement} />
      <PopoverContent align="start" className="w-80">
        <p className="px-1 text-xs font-medium text-muted-foreground">Course icon</p>
        <div
          className="grid grid-cols-8 gap-1"
          role="grid"
          aria-label="Course icons"
        >
          {COURSE_ICONS.map((item) => {
            const pressed = selectedIcon === item.key;
            return (
              <IconButton
                key={item.key}
                icon={item.Icon}
                label={item.label}
                size="icon-sm"
                variant="ghost"
                aria-pressed={pressed}
                className={cn(pressed && "bg-selected text-foreground")}
                onClick={() => onPickIcon(item.key)}
              />
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-1" role="group" aria-label="Course colors">
          {COURSE_COLORS.map((item) => {
            const pressed = selectedColor === item.key;
            return (
              <Button
                key={item.key}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={item.label}
                aria-pressed={pressed}
                className={cn(
                  "rounded-full border border-border p-0",
                  pressed && "ring-2 ring-ring ring-offset-1 ring-offset-popover",
                )}
                onClick={() => onPickColor(item.key)}
              >
                <span className={cn("size-4 rounded-full", item.swatchClassName)} aria-hidden />
              </Button>
            );
          })}
        </div>
        <Button type="button" variant="link" size="sm" className="h-auto px-1" onClick={onReset}>
          Reset
        </Button>
      </PopoverContent>
    </Popover>
  );
}

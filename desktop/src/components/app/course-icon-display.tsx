/* eslint-disable react-hooks/static-components -- icons are resolved from the static COURSE_ICONS catalog */
import type { CourseMetaMap } from "~/domain/course-icons";
import {
  courseColorClass,
  courseIconFor,
  courseIconKey,
} from "~/domain/course-icons";
import { cn } from "~/lib/utils";

export function CourseIconDisplay({
  meta,
  course,
  className,
  active = false,
}: {
  meta: CourseMetaMap | undefined;
  course: string;
  className?: string;
  active?: boolean;
}) {
  const iconKey = courseIconKey(meta, course);
  const Icon = courseIconFor(meta, course);
  const colorClass = courseColorClass(meta, course);
  return (
    <Icon
      data-icon={iconKey}
      className={cn(
        "size-icon-sm shrink-0",
        active ? "text-primary" : colorClass,
        className,
      )}
      aria-hidden
    />
  );
}

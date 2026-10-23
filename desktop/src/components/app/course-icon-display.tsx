/* eslint-disable react-hooks/static-components -- icons resolve from the lazy-loaded catalog */
import { BookOpen, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { CourseMetaMap } from "~/domain/course-icons";
import { courseColorClass, courseIconKey } from "~/domain/course-icons";
import { cn } from "~/lib/utils";

export function CourseIconDisplay({
  meta,
  course,
  className,
}: {
  meta: CourseMetaMap | undefined;
  course: string;
  className?: string;
}) {
  const iconKey = courseIconKey(meta, course);
  const colorClass = courseColorClass(meta, course);
  const [Icon, setIcon] = useState<LucideIcon>(() => BookOpen);

  useEffect(() => {
    let active = true;
    void import("~/domain/course-icons-catalog").then((mod) => {
      if (active) {
        setIcon(() => mod.iconByKey.get(iconKey) ?? BookOpen);
      }
    });
    return () => {
      active = false;
    };
  }, [iconKey]);

  return (
    <Icon
      data-icon={iconKey}
      className={cn("size-icon-sm shrink-0", colorClass, className)}
      aria-hidden
    />
  );
}

import { COURSE_COLORS, type CourseMetaMap } from "~/domain/course-icons";
import { cn } from "~/lib/utils";

/** A stable colour for a class that has none picked yet, so neighbouring classes stay distinct. */
function fallbackColorKey(course: string): string {
  let hash = 0;
  for (const char of course) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return COURSE_COLORS[hash % COURSE_COLORS.length]!.key;
}

/** The class's colour key: the picked one, else a stable fallback. */
export function courseSwatchKey(meta: CourseMetaMap | undefined, course: string): string {
  const picked = meta?.[course]?.color;
  return picked && COURSE_COLORS.some((entry) => entry.key === picked)
    ? picked
    : fallbackColorKey(course);
}

/** The design's 10 px class swatch (Components › Course swatch), used by the sidebar and Today. */
export function CourseSwatch({
  meta,
  course,
  className,
}: {
  meta: CourseMetaMap | undefined;
  course: string;
  className?: string;
}) {
  const key = courseSwatchKey(meta, course);
  const entry = COURSE_COLORS.find((candidate) => candidate.key === key)!;
  return (
    <span
      data-course-color={key}
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-xs", entry.swatchClassName, className)}
    />
  );
}

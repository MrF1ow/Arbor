export type CourseMetaEntry = {
  icon?: string;
  color?: string;
  [key: string]: unknown;
};

export type CourseMetaMap = Record<string, CourseMetaEntry>;

export const COURSE_ICON_KEYS = [
  "book-open",
  "flask-conical",
  "atom",
  "dna",
  "microscope",
  "leaf",
  "sprout",
  "brain",
  "heart-pulse",
  "stethoscope",
  "pill",
  "telescope",
  "orbit",
  "mountain",
  "globe",
  "zap",
  "magnet",
  "calculator",
  "sigma",
  "pi",
  "square-function",
  "binary",
  "code",
  "cpu",
  "database",
  "chart-line",
  "landmark",
  "scroll",
  "feather",
  "book-text",
  "languages",
  "quote",
  "music",
  "palette",
  "drama",
  "scale",
  "briefcase",
  "banknote",
  "users",
  "gavel",
] as const;

const iconKeySet = new Set<string>(COURSE_ICON_KEYS);

export const COURSE_COLORS: readonly {
  key: string;
  label: string;
  className: string;
  swatchClassName: string;
}[] = [
  { key: "olive", label: "Olive", className: "text-course-olive", swatchClassName: "bg-course-olive" },
  { key: "bark", label: "Bark", className: "text-course-bark", swatchClassName: "bg-course-bark" },
  { key: "clay", label: "Clay", className: "text-course-clay", swatchClassName: "bg-course-clay" },
  { key: "sky", label: "Sky", className: "text-course-sky", swatchClassName: "bg-course-sky" },
  { key: "plum", label: "Plum", className: "text-course-plum", swatchClassName: "bg-course-plum" },
  { key: "sand", label: "Sand", className: "text-course-sand", swatchClassName: "bg-course-sand" },
  { key: "slate", label: "Slate", className: "text-course-slate", swatchClassName: "bg-course-slate" },
  { key: "moss", label: "Moss", className: "text-course-moss", swatchClassName: "bg-course-moss" },
] as const;

const colorClassByKey = new Map(COURSE_COLORS.map((entry) => [entry.key, entry.className]));

export function courseIconKey(meta: CourseMetaMap | undefined, course: string): string {
  const key = meta?.[course]?.icon;
  if (key && iconKeySet.has(key)) {
    return key;
  }
  return "book-open";
}

export function courseColorClass(meta: CourseMetaMap | undefined, course: string): string {
  const key = meta?.[course]?.color;
  if (!key) {
    return "";
  }
  return colorClassByKey.get(key) ?? "";
}

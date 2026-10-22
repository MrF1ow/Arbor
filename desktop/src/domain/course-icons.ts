import type { LucideIcon } from "lucide-react";
import {
  Atom,
  Banknote,
  Binary,
  BookOpen,
  BookText,
  Brain,
  Briefcase,
  Calculator,
  ChartLine,
  Code,
  Cpu,
  Database,
  Dna,
  Drama,
  Feather,
  FlaskConical,
  Gavel,
  Globe,
  HeartPulse,
  Landmark,
  Languages,
  Leaf,
  Magnet,
  Microscope,
  Mountain,
  Music,
  Orbit,
  Palette,
  Pi,
  Pill,
  Quote,
  Scale,
  Scroll,
  Sigma,
  Sprout,
  SquareFunction,
  Stethoscope,
  Telescope,
  Users,
  Zap,
} from "lucide-react";

export type CourseMetaEntry = {
  icon?: string;
  color?: string;
  [key: string]: unknown;
};

export type CourseMetaMap = Record<string, CourseMetaEntry>;

export const COURSE_ICONS: readonly { key: string; label: string; Icon: LucideIcon }[] = [
  { key: "book-open", label: "General", Icon: BookOpen },
  { key: "flask-conical", label: "Chemistry", Icon: FlaskConical },
  { key: "atom", label: "Physics", Icon: Atom },
  { key: "dna", label: "Genetics", Icon: Dna },
  { key: "microscope", label: "Biology lab", Icon: Microscope },
  { key: "leaf", label: "Ecology", Icon: Leaf },
  { key: "sprout", label: "Botany", Icon: Sprout },
  { key: "brain", label: "Neuroscience", Icon: Brain },
  { key: "heart-pulse", label: "Physiology", Icon: HeartPulse },
  { key: "stethoscope", label: "Medicine", Icon: Stethoscope },
  { key: "pill", label: "Pharmacology", Icon: Pill },
  { key: "telescope", label: "Astronomy", Icon: Telescope },
  { key: "orbit", label: "Space", Icon: Orbit },
  { key: "mountain", label: "Earth science", Icon: Mountain },
  { key: "globe", label: "Geography", Icon: Globe },
  { key: "zap", label: "Energy", Icon: Zap },
  { key: "magnet", label: "Electromagnetism", Icon: Magnet },
  { key: "calculator", label: "Mathematics", Icon: Calculator },
  { key: "sigma", label: "Statistics", Icon: Sigma },
  { key: "pi", label: "Calculus", Icon: Pi },
  { key: "square-function", label: "Functions", Icon: SquareFunction },
  { key: "binary", label: "Computer science", Icon: Binary },
  { key: "code", label: "Programming", Icon: Code },
  { key: "cpu", label: "Systems", Icon: Cpu },
  { key: "database", label: "Data", Icon: Database },
  { key: "chart-line", label: "Analytics", Icon: ChartLine },
  { key: "landmark", label: "History", Icon: Landmark },
  { key: "scroll", label: "Classics", Icon: Scroll },
  { key: "feather", label: "Literature", Icon: Feather },
  { key: "book-text", label: "Reading", Icon: BookText },
  { key: "languages", label: "Languages", Icon: Languages },
  { key: "quote", label: "Philosophy", Icon: Quote },
  { key: "music", label: "Music", Icon: Music },
  { key: "palette", label: "Art", Icon: Palette },
  { key: "drama", label: "Theater", Icon: Drama },
  { key: "scale", label: "Law", Icon: Scale },
  { key: "briefcase", label: "Business", Icon: Briefcase },
  { key: "banknote", label: "Economics", Icon: Banknote },
  { key: "users", label: "Sociology", Icon: Users },
  { key: "gavel", label: "Policy", Icon: Gavel },
] as const;

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

const iconByKey = new Map(COURSE_ICONS.map((entry) => [entry.key, entry.Icon]));
const colorClassByKey = new Map(COURSE_COLORS.map((entry) => [entry.key, entry.className]));

export function courseIconKey(meta: CourseMetaMap | undefined, course: string): string {
  const key = meta?.[course]?.icon;
  if (key && iconByKey.has(key)) {
    return key;
  }
  return "book-open";
}

export function courseIconFor(meta: CourseMetaMap | undefined, course: string): LucideIcon {
  return iconByKey.get(courseIconKey(meta, course)) ?? BookOpen;
}

export function courseColorClass(meta: CourseMetaMap | undefined, course: string): string {
  const key = meta?.[course]?.color;
  if (!key) {
    return "";
  }
  return colorClassByKey.get(key) ?? "";
}

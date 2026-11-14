import type { ReadingEntry } from "~/domain/lectures";
import { toCourseDigest } from "~/domain/lectures";
import { digestSlugFromPath } from "~/domain/notes";
import type { Acc, TodayCourse } from "~/domain/today";
import type { DigestInfo } from "~/domain/types";

/** Review time is estimated, not measured: 18 seconds a card (plan Risks). */
export const SECONDS_PER_CARD = 18;

/** Continue reading shows this many lectures (the design's frame shows four). */
export const CONTINUE_READING_LIMIT = 4;

/** Whole minutes to review `cards` cards, at least 1 while any are due. */
export function reviewMinutes(cards: number): number {
  return cards > 0 ? Math.max(1, Math.round((cards * SECONDS_PER_CARD) / 60)) : 0;
}

export const classKey = (c: { root: string; course: string }) => `${c.root}::${c.course}`;

/**
 * The classes Start review can open, in the order it opens them (Q15, Q27): only classes with a
 * card due; the nearest upcoming exam first, classes without one after, then the most due cards,
 * then the folder name so the order never flickers.
 */
export function reviewOrder(courses: TodayCourse[]): TodayCourse[] {
  const examDays = (c: TodayCourse) =>
    c.days_to_exam !== null && c.days_to_exam >= 0 ? c.days_to_exam : Number.POSITIVE_INFINITY;
  return courses
    .filter((c) => c.due_ids.length > 0)
    .sort(
      (a, b) =>
        examDays(a) - examDays(b) ||
        b.due_ids.length - a.due_ids.length ||
        a.course.localeCompare(b.course) ||
        a.root.localeCompare(b.root),
    );
}

export function daysLeftLabel(days: number): string {
  if (days <= 0) {
    return "Today";
  }
  return days === 1 ? "1 day" : `${days} days`;
}

/** Whole-number percent, or null when nothing was answered. */
export function accuracyPercent(acc: Acc): number | null {
  return acc.total > 0 ? Math.round((acc.correct / acc.total) * 100) : null;
}

/** "last 7 days · up from 71%"; just "last 7 days" when last week has no answers to compare. */
export function accuracyCaption(thisWeek: Acc, lastWeek: Acc): string {
  const now = accuracyPercent(thisWeek);
  const before = accuracyPercent(lastWeek);
  if (now === null || before === null) {
    return "last 7 days";
  }
  if (now === before) {
    return `last 7 days · same as ${before}%`;
  }
  return `last 7 days · ${now > before ? "up" : "down"} from ${before}%`;
}

/** "2026-11-16" → "Nov 16", read as a local date so the day never shifts with the time zone. */
export function formatExamDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) {
    return iso;
  }
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Thursday, Nov 7". */
export function formatToday(now: Date): string {
  return now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export type ContinueSource = {
  root: string;
  course: string;
  digests: DigestInfo[];
  reading: Record<string, ReadingEntry>;
};

export type ContinueItem = {
  root: string;
  course: string;
  /** Course-prefixed digest path. */
  digest: string;
  slug: string;
  title: string;
  /** How far the lecture was read, or null when it was never opened. */
  fraction: number | null;
};

/**
 * Lectures to pick up again (Q26): opened but not read to the end ("N% read", most recently
 * opened first), then never opened ("New", newest lecture first). Read lectures drop off.
 */
export function continueReading(sources: ContinueSource[], limit = CONTINUE_READING_LIMIT): ContinueItem[] {
  const opened: { item: ContinueItem; sortKey: string }[] = [];
  const fresh: { item: ContinueItem; sortKey: string }[] = [];
  for (const source of sources) {
    for (const info of source.digests) {
      const digest = toCourseDigest(source.course, info.path);
      const entry = source.reading[digest];
      if (entry?.read) {
        continue;
      }
      const item: ContinueItem = {
        root: source.root,
        course: source.course,
        digest,
        slug: digestSlugFromPath(info.path),
        title: info.title,
        fraction: entry ? entry.fraction : null,
      };
      (entry ? opened : fresh).push({ item, sortKey: entry ? entry.last_opened : info.date });
    }
  }
  const newestFirst = (a: { item: ContinueItem; sortKey: string }, b: { item: ContinueItem; sortKey: string }) =>
    b.sortKey.localeCompare(a.sortKey) || a.item.digest.localeCompare(b.item.digest);
  return [...opened.sort(newestFirst), ...fresh.sort(newestFirst)].slice(0, limit).map((entry) => entry.item);
}

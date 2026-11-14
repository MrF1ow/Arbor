import { digestKey } from "~/domain/concepts";
import type { DigestInfo } from "~/domain/types";

/** A class's digest-stats row (`study_progress digest-stats`), keyed by `digests/x.md`. */
export type DigestStatsRow = {
  cards: number;
  due: number;
  mastered: number;
  /** Share of cards at interval >= 21 days (0..1); null when the lecture has no cards. */
  mastery: number | null;
  quiz_correct: number;
  quiz_wrong: number;
  card_correct: number;
  card_wrong: number;
};

/** One entry of `read_reading_state`, keyed by `Course/digests/x.md`. */
export type ReadingEntry = { fraction: number; last_opened: string; read: boolean };

export type LectureBadge =
  /** `value` is the whole-number percent of cards mastered; red when `weak`. */
  | { kind: "mastery"; value: number; weak: boolean }
  | { kind: "new" }
  | { kind: "unread" }
  | null;

export type LectureRow = {
  /** Course-prefixed path, the one form every command takes. */
  digest: string;
  title: string;
  date: string;
  weak: boolean;
  due: number;
  read: boolean;
  badge: LectureBadge;
};

export type UnitRows = { unit: string; lectures: LectureRow[] };

export type LectureFilter = "all" | "unread" | "weak" | "due";

/** Heading for lectures whose source sits at the class root, outside any unit folder. */
export const NO_UNIT_LABEL = "Lectures";

const WEAK_MIN_ANSWERS = 3;
const WEAK_WRONG_SHARE = 0.4;

/**
 * Map `digests/x.md`, `Course/digests/x.md` and a bare `x.md` to the course-prefixed form
 * that `list_digests`, reading state, `start_chat` and `start_study_job` use (Q17).
 */
export function toCourseDigest(course: string, path: string): string {
  // The course prefix goes first: `digestKey` cuts at the first `digests/`, which is inside the
  // folder name of a class such as "Weekly digests" and would double the segment.
  const rest = path.startsWith(`${course}/`) ? path.slice(course.length + 1) : path;
  return `${course}/${digestKey(rest)}`;
}

function isWeak(stats: DigestStatsRow | undefined): boolean {
  if (!stats) {
    return false;
  }
  // A worker that leaves a count out (an older one) counts it as 0, not NaN.
  const wrong = (stats.quiz_wrong ?? 0) + (stats.card_wrong ?? 0);
  const answers = (stats.quiz_correct ?? 0) + (stats.card_correct ?? 0) + wrong;
  return answers >= WEAK_MIN_ANSWERS && wrong / answers > WEAK_WRONG_SHARE;
}

function badgeFor(
  stats: DigestStatsRow | undefined,
  reading: ReadingEntry | undefined,
  weak: boolean,
): LectureBadge {
  if (stats && stats.cards > 0 && stats.mastery !== null) {
    return { kind: "mastery", value: Math.round(stats.mastery * 100), weak };
  }
  if (!reading) {
    return { kind: "new" };
  }
  return reading.read ? null : { kind: "unread" };
}

/**
 * Lecture column rows: lectures grouped by unit, newest unit first (by its newest digest
 * date), lectures within a unit in date order, no lecture numbers (Q16). Lectures with no
 * unit go under "Lectures". `stats` is keyed by any digest path form; `reading` by the
 * course-prefixed path.
 */
export function buildLectureRows(
  course: string,
  digests: DigestInfo[],
  stats: Record<string, DigestStatsRow>,
  reading: Record<string, ReadingEntry>,
): UnitRows[] {
  const statsByDigest = new Map<string, DigestStatsRow>();
  for (const [key, row] of Object.entries(stats)) {
    statsByDigest.set(toCourseDigest(course, key), row);
  }
  const units = new Map<string, LectureRow[]>();
  for (const info of digests) {
    const digest = toCourseDigest(course, info.path);
    const row = statsByDigest.get(digest);
    const entry = reading[digest];
    const weak = isWeak(row);
    const lecture: LectureRow = {
      digest,
      title: info.title,
      date: info.date,
      weak,
      due: row?.due ?? 0,
      read: entry?.read === true,
      badge: badgeFor(row, entry, weak),
    };
    const unit = info.unit?.trim() || NO_UNIT_LABEL;
    const list = units.get(unit);
    if (list) {
      list.push(lecture);
    } else {
      units.set(unit, [lecture]);
    }
  }
  const groups: UnitRows[] = [];
  for (const [unit, lectures] of units) {
    lectures.sort((a, b) => a.date.localeCompare(b.date) || a.digest.localeCompare(b.digest));
    groups.push({ unit, lectures });
  }
  const newest = (group: UnitRows) => group.lectures[group.lectures.length - 1]!.date;
  groups.sort((a, b) => newest(b).localeCompare(newest(a)) || a.unit.localeCompare(b.unit));
  return groups;
}

const FILTERS: Record<LectureFilter, (lecture: LectureRow) => boolean> = {
  all: () => true,
  unread: (lecture) => !lecture.read,
  weak: (lecture) => lecture.weak,
  due: (lecture) => lecture.due > 0,
};

/** Rows that pass a filter chip; units left empty are dropped. */
export function filterLectures(rows: UnitRows[], filter: LectureFilter): UnitRows[] {
  const keep = FILTERS[filter];
  return rows
    .map((group) => ({ unit: group.unit, lectures: group.lectures.filter(keep) }))
    .filter((group) => group.lectures.length > 0);
}

/** The counts on the All / Unread / Weak / Due chips. */
export function countLectures(rows: UnitRows[]): Record<LectureFilter, number> {
  const counts: Record<LectureFilter, number> = { all: 0, unread: 0, weak: 0, due: 0 };
  for (const filter of Object.keys(counts) as LectureFilter[]) {
    counts[filter] = filterLectures(rows, filter).reduce((n, g) => n + g.lectures.length, 0);
  }
  return counts;
}

/**
 * "<unit> · K lectures" when the ticked lectures make up one whole unit, else "K lectures";
 * null with nothing ticked (Q16).
 */
export function scopeLabel(rows: UnitRows[], ticked: string[]): string | null {
  if (ticked.length === 0) {
    return null;
  }
  const count = `${ticked.length} ${ticked.length === 1 ? "lecture" : "lectures"}`;
  const set = new Set(ticked);
  const whole = rows.find(
    (group) =>
      group.unit !== NO_UNIT_LABEL &&
      group.lectures.length === set.size &&
      group.lectures.every((lecture) => set.has(lecture.digest)),
  );
  return whole ? `${whole.unit} · ${count}` : count;
}

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
 * Case-insensitive compare that reads digit runs as numbers, so `09-x` < `10-x` and
 * `Lecture 2` < `lecture 10`. Returns 0 for names that differ only in case or leading zeros.
 */
export function naturalCompare(a: string, b: string): number {
  // Splitting on a capturing group puts text at even indices and digit runs at odd ones.
  const left = a.toLowerCase().split(/(\d+)/);
  const right = b.toLowerCase().split(/(\d+)/);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i]!;
    const y = right[i]!;
    if (i % 2 === 1) {
      const nx = x.replace(/^0+(?=\d)/, "");
      const ny = y.replace(/^0+(?=\d)/, "");
      if (nx.length !== ny.length) {
        return nx.length - ny.length;
      }
      if (nx !== ny) {
        return nx < ny ? -1 : 1;
      }
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return left.length - right.length;
}

/**
 * `[base, n]` of a digest path's stem: a `-N` after a `THHMM` stamp is a number, no suffix reads
 * as 1. The worker writes `YYYY-MM-DD`, `YYYY-MM-DDTHHMM` and `YYYY-MM-DDTHHMM-N`, so the
 * date-only stem `2026-09-13` has no suffix.
 */
function stemKey(path: string): [string, number] {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  const match = /^(.*T\d{4})-(\d+)$/.exec(name);
  return match ? [match[1]!, Number(match[2])] : [name, 1];
}

function compareStems(a: string, b: string): number {
  const [baseA, nA] = stemKey(a);
  const [baseB, nB] = stemKey(b);
  if (baseA !== baseB) {
    return baseA < baseB ? -1 : 1;
  }
  return nA - nB || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * One total order for a unit's lectures: rows with a `source_path` first, in natural order of
 * that path (then the stem rule for digests of one source); then rows without one, by date
 * then the stem rule. Never compares a source key with a date key, so it cannot cycle.
 */
function compareLectures(a: DigestInfo, b: DigestInfo): number {
  const hasA = Boolean(a.source_path);
  const hasB = Boolean(b.source_path);
  if (hasA !== hasB) {
    return hasA ? -1 : 1;
  }
  if (hasA) {
    const bySource = naturalCompare(a.source_path!, b.source_path!);
    if (bySource !== 0) {
      return bySource;
    }
    return compareStems(a.path, b.path);
  }
  return a.date < b.date ? -1 : a.date > b.date ? 1 : compareStems(a.path, b.path);
}

/**
 * Lecture column rows: lectures grouped by unit, newest unit first (by its newest digest
 * date), lectures within a unit in source-file order (Q5), no lecture numbers (Q16). Lectures with no
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
  const units = new Map<string, { info: DigestInfo; lecture: LectureRow }[]>();
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
      list.push({ info, lecture });
    } else {
      units.set(unit, [{ info, lecture }]);
    }
  }
  const groups: UnitRows[] = [];
  for (const [unit, entries] of units) {
    entries.sort((a, b) => compareLectures(a.info, b.info));
    groups.push({ unit, lectures: entries.map((entry) => entry.lecture) });
  }
  // Newest by the max date in the group, not the last row's: source order need not be date order.
  const newest = (group: UnitRows) =>
    group.lectures.reduce((max, lecture) => (lecture.date > max ? lecture.date : max), "");
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

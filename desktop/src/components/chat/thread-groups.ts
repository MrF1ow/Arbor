import { relativeTime } from "~/domain/jobs";
import type { ChatThreadMeta } from "~/lib/queries/chat";

export type ThreadGroup = { label: "Today" | "This week" | "Earlier"; threads: ChatThreadMeta[] };

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const OLD_STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})Z\.(\d+)$/;

/**
 * A chat stamp as epoch milliseconds, or null when it cannot be parsed. Accepts RFC 3339 and the
 * `…SSZ.fff` form older builds wrote, which is read as `…SS.fffZ`.
 */
export function stampMs(stamp: string): number | null {
  const ms = Date.parse(stamp.replace(OLD_STAMP, "$1.$2Z"));
  return Number.isNaN(ms) ? null : ms;
}

/** Whole calendar days between a thread's last update and `now`; 0 is today. */
function daysAgo(updatedMs: number | null, now: Date): number {
  if (updatedMs === null) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.round((startOfDay(now) - startOfDay(new Date(updatedMs))) / DAY_MS);
}

/** The Chats list's sections: Today, This week (the last six days) and Earlier, newest first. */
export function groupThreadsByDay(threads: ChatThreadMeta[], now: Date): ThreadGroup[] {
  const stamped = threads.map((thread) => ({ thread, ms: stampMs(thread.updated_at) }));
  stamped.sort((a, b) => {
    if (a.ms !== null && b.ms !== null && a.ms !== b.ms) {
      return b.ms - a.ms;
    }
    if (a.ms === null && b.ms !== null) {
      return 1;
    }
    if (a.ms !== null && b.ms === null) {
      return -1;
    }
    return b.thread.updated_at.localeCompare(a.thread.updated_at);
  });
  const groups: ThreadGroup[] = [
    { label: "Today", threads: [] },
    { label: "This week", threads: [] },
    { label: "Earlier", threads: [] },
  ];
  for (const { thread, ms } of stamped) {
    const days = daysAgo(ms, now);
    groups[days <= 0 ? 0 : days < 7 ? 1 : 2]!.threads.push(thread);
  }
  return groups.filter((group) => group.threads.length > 0);
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** "Explain · 2 hr ago" today, "Ask · Tue" this week, "Ask · Oct 1" before that, and the mode alone when the stamp cannot be read. */
export function threadMeta(thread: ChatThreadMeta, now: Date): string {
  const mode = thread.mode === "explain" ? "Explain" : "Ask";
  const ms = stampMs(thread.updated_at);
  if (ms === null) {
    return mode;
  }
  const days = daysAgo(ms, now);
  const updated = new Date(ms);
  let when: string;
  if (days <= 0) {
    const text = relativeTime(updated.toISOString(), now.getTime());
    when = text === "just now" ? "now" : text;
  } else if (days < 7) {
    when = WEEKDAY.format(updated);
  } else {
    when = MONTH_DAY.format(updated);
  }
  return `${mode} · ${when}`;
}

import { relativeTime } from "~/domain/jobs";
import type { ChatThreadMeta } from "~/lib/queries/chat";

export type ThreadGroup = { label: "Today" | "This week" | "Earlier"; threads: ChatThreadMeta[] };

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole calendar days between a thread's last update and `now`; 0 is today. */
function daysAgo(updatedAt: string, now: Date): number {
  const then = new Date(updatedAt);
  if (Number.isNaN(then.getTime())) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.round((startOfDay(now) - startOfDay(then)) / DAY_MS);
}

/** The Chats list's sections: Today, This week (the last six days) and Earlier, newest first. */
export function groupThreadsByDay(threads: ChatThreadMeta[], now: Date): ThreadGroup[] {
  const sorted = threads.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const groups: ThreadGroup[] = [
    { label: "Today", threads: [] },
    { label: "This week", threads: [] },
    { label: "Earlier", threads: [] },
  ];
  for (const thread of sorted) {
    const days = daysAgo(thread.updated_at, now);
    groups[days <= 0 ? 0 : days < 7 ? 1 : 2]!.threads.push(thread);
  }
  return groups.filter((group) => group.threads.length > 0);
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** "Explain · 2 hr ago" today, "Ask · Tue" this week, "Ask · Oct 1" before that. */
export function threadMeta(thread: ChatThreadMeta, now: Date): string {
  const mode = thread.mode === "explain" ? "Explain" : "Ask";
  const days = daysAgo(thread.updated_at, now);
  const updated = new Date(thread.updated_at);
  let when: string;
  if (days <= 0) {
    const text = relativeTime(thread.updated_at, now.getTime());
    when = text === "just now" ? "now" : text;
  } else if (days < 7) {
    when = WEEKDAY.format(updated);
  } else {
    when = MONTH_DAY.format(updated);
  }
  return `${mode} · ${when}`;
}

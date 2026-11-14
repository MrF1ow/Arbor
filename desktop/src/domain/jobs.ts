import { courseDisplayName } from "./course.ts";

const SKILL_LABELS: Record<string, string> = {
  flashcards: "Flashcards",
  quiz: "Quiz",
  concepts: "Concepts",
  diagrams: "Diagrams",
  citations: "Citations",
  embed: "Embeddings",
};

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual update",
  watch: "Folder watch",
};

function titleCaseKind(kind: string): string {
  return kind
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function jobKindLabel(triggerKind: string, skill?: string | null): string {
  const skillKey = skill?.trim().toLowerCase();
  if (skillKey && SKILL_LABELS[skillKey]) {
    return SKILL_LABELS[skillKey]!;
  }
  const triggerKey = triggerKind.trim().toLowerCase();
  if (TRIGGER_LABELS[triggerKey]) {
    return TRIGGER_LABELS[triggerKey]!;
  }
  return titleCaseKind(triggerKind);
}

export function relativeTime(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return iso;
  }
  const diffMs = Math.max(0, nowMs - then);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return minutes === 1 ? "1 min ago" : `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return hours === 1 ? "1 hr ago" : `${hours} hr ago`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) {
    return "running";
  }
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return "—";
  }
  const totalSec = Math.floor((end - start) / 1000);
  if (totalSec < 60) {
    return `${totalSec}s`;
  }
  const minutes = Math.round(totalSec / 60);
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
  return `${minutes} min`;
}

export function formatJobTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const TITLES: Record<string, string> = {
  flashcards: "Generate flashcards",
  quiz: "Generate quiz",
  concepts: "Concept map",
  diagrams: "Generate diagrams",
  citations: "Check citations",
  embed: "Build embeddings",
};

/** The Jobs table's name for a job: what it did, in the design's words ("Generate flashcards"). */
export function jobTitle(triggerKind: string, skill?: string | null): string {
  const skillKey = skill?.trim().toLowerCase();
  if (skillKey && TITLES[skillKey]) {
    return TITLES[skillKey]!;
  }
  const triggerKey = triggerKind.trim().toLowerCase();
  if (triggerKey === "manual" || triggerKey === "watch") {
    return "Update knowledge";
  }
  return jobKindLabel(triggerKind, skill);
}

/** The Started column: the time of day for today, "Yesterday", else the date ("Oct 3"). */
export function jobStartedLabel(iso: string, nowMs: number): string {
  const started = new Date(iso);
  if (Number.isNaN(started.getTime())) {
    return iso;
  }
  const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const daysAgo = Math.round((dayStart(new Date(nowMs)) - dayStart(started)) / 86_400_000);
  if (daysAgo <= 0) {
    return started.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (daysAgo === 1) {
    return "Yesterday";
  }
  return started.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The Jobs filter chips' counts; a cancelled job is only ever under All. */
export function jobStatusCounts(jobs: { status: string }[]) {
  const count = (status: string) => jobs.filter((job) => job.status === status).length;
  return {
    all: jobs.length,
    running: count("running"),
    failed: count("failed"),
    succeeded: count("succeeded"),
  };
}

/** What a job covered, as stored on its row (I1). */
export type JobScope = { course: string | null; digests: string[] | null };

/** Digest paths per class with their unit, as `list_digests` returns them. */
export type DigestUnitsByCourse = Record<string, { path: string; unit: string | null }[]>;

function lectureCount(count: number): string {
  return `${count} ${count === 1 ? "lecture" : "lectures"}`;
}

/**
 * The Jobs table's Scope column: "<class> · <unit> · K lectures" when every lecture shares a
 * unit, "<class> · K lectures" otherwise, "<class>" for a whole-class run or an update
 * (whose digests are source files, not lectures), and "—" when the job has no class (Q30).
 */
export function jobScopeLabel(scope: JobScope, units: DigestUnitsByCourse): string {
  const { course, digests } = scope;
  if (!course) {
    return "—";
  }
  const name = courseDisplayName(course);
  const lectures = (digests ?? []).filter((path) => path.includes("/digests/"));
  if (lectures.length === 0) {
    return name;
  }
  // A remote full run's plan lists every digest of the class (worker.rs `resolve_study_job_digests`),
  // so it reads as the whole class, not "N lectures".
  const classDigests = units[course] ?? [];
  const covered = new Set(lectures);
  if (classDigests.length > 0 && classDigests.every((d) => covered.has(d.path))) {
    return name;
  }
  const known = new Map(classDigests.map((d) => [d.path, d.unit]));
  const found = lectures.map((path) => known.get(path) ?? null);
  const first = found[0];
  const sharedUnit = first && found.every((unit) => unit === first) ? first : null;
  return sharedUnit
    ? `${name} · ${sharedUnit} · ${lectureCount(lectures.length)}`
    : `${name} · ${lectureCount(lectures.length)}`;
}

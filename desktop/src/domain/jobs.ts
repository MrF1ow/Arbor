const KIND_LABELS: Record<string, string> = {
  manual: "Manual update",
  watch: "Folder watch",
  embed: "Embeddings",
  citations: "Citations",
  flashcards: "Flashcards",
  quiz: "Quiz",
  concepts: "Concepts",
  diagrams: "Diagrams",
  study: "Study",
};

function titleCaseKind(kind: string): string {
  return kind
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function jobKindLabel(triggerKind: string): string {
  const key = triggerKind.trim().toLowerCase();
  return KIND_LABELS[key] ?? titleCaseKind(triggerKind);
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
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remMin = minutes % 60;
    return `${hours}h ${remMin}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
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

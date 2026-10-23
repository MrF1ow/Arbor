export type UsageWindowKind = "session" | "weekly" | "monthly" | "other";

export type UsageWindow = {
  id: string;
  kind: UsageWindowKind;
  label: string;
  used_percent: number;
  resets_at?: string;
  window_minutes?: number;
};

export type UsageLimits = {
  checked_at: string;
  windows: UsageWindow[];
  unavailable?: {
    reason: "unsupported" | "probe_failed";
    message?: string;
  };
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function remainingPercent(window: Pick<UsageWindow, "used_percent">): number {
  return Math.round(100 - Math.max(0, Math.min(100, window.used_percent)));
}

function resetMillis(window: Pick<UsageWindow, "resets_at">): number | null {
  if (!window.resets_at) {
    return null;
  }
  const at = Date.parse(window.resets_at);
  return Number.isFinite(at) ? at : null;
}

export function elapsedShare(
  window: Pick<UsageWindow, "resets_at" | "window_minutes">,
  now: number,
): number | null {
  const resetsAt = resetMillis(window);
  if (resetsAt === null || window.window_minutes === undefined) {
    return null;
  }
  const length = window.window_minutes * MINUTE;
  if (length <= 0) {
    return null;
  }
  return Math.max(0, Math.min(1, (length - (resetsAt - now)) / length));
}

export function paceRemainingPercent(
  window: Pick<UsageWindow, "resets_at" | "window_minutes">,
  now: number,
): number | null {
  const elapsed = elapsedShare(window, now);
  return elapsed === null ? null : Math.round((1 - elapsed) * 100);
}

export type LimitPace = "ahead" | "on" | "under";

function paceOfShares(usedPercent: number, elapsed: number): LimitPace {
  const gap = usedPercent - elapsed * 100;
  if (gap > 5) {
    return "ahead";
  }
  if (gap < -5) {
    return "under";
  }
  return "on";
}

export function paceOf(
  window: Pick<UsageWindow, "used_percent" | "resets_at" | "window_minutes">,
  now: number,
): LimitPace | null {
  const elapsed = elapsedShare(window, now);
  return elapsed === null ? null : paceOfShares(window.used_percent, elapsed);
}

export function formatDuration(ms: number): string {
  const remaining = Math.max(0, ms);
  const days = Math.floor(remaining / DAY);
  const hours = Math.floor((remaining % DAY) / HOUR);
  const minutes = Math.floor((remaining % HOUR) / MINUTE);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatResetsIn(
  window: Pick<UsageWindow, "resets_at">,
  now: number,
): string | null {
  const resetsAt = resetMillis(window);
  if (resetsAt === null) {
    return null;
  }
  if (resetsAt <= now) {
    return "resets now";
  }
  if (resetsAt - now < MINUTE) {
    return "Resets momentarily";
  }
  return `resets in ${formatDuration(resetsAt - now)}`;
}

export function formatResetsOnDate(iso: string): string | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) {
    return null;
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(at);
}

export function formatCheckedAgo(checkedAt: string, now: number): string {
  const at = Date.parse(checkedAt);
  if (!Number.isFinite(at)) {
    return "Checked recently";
  }
  const diff = Math.max(0, now - at);
  if (diff < MINUTE) {
    return "Checked just now";
  }
  if (diff < HOUR) {
    const mins = Math.round(diff / MINUTE);
    return `Checked ${mins} min ago`;
  }
  const hours = Math.round(diff / HOUR);
  return `Checked ${hours}h ago`;
}

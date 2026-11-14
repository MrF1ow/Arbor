import type { LectureRow } from "~/domain/lectures";
import { cn } from "~/lib/utils";

type Tone = "good" | "neutral" | "weak";

/** Mastery at or above this reads as "good" (green), like the design's 88-95% rows. */
const GOOD_MASTERY = 85;

const TONE_CLASS: Record<Tone, string> = {
  good: "bg-accent text-accent-foreground",
  neutral: "bg-muted text-muted-foreground",
  weak: "bg-destructive-surface text-destructive",
};

/**
 * The tag at the end of a lecture row (Q25, Q26): the % mastered when the lecture has cards
 * (red only when Weak), else New, Unread or nothing. A lecture that is Weak from quiz answers
 * alone has no cards, so no % to colour red: it gets a red "Weak" tag in the same slot, so it
 * is never left looking plain.
 */
export function LectureBadge({ lecture }: { lecture: LectureRow }) {
  const badge = lecture.badge;
  let tone: Tone = "neutral";
  let label: string;
  if (badge?.kind === "mastery") {
    label = `${badge.value}%`;
    tone = badge.weak ? "weak" : badge.value >= GOOD_MASTERY ? "good" : "neutral";
  } else if (lecture.weak) {
    label = "Weak";
    tone = "weak";
  } else if (badge?.kind === "new") {
    label = "New";
  } else if (badge?.kind === "unread") {
    label = "Unread";
  } else {
    return null;
  }
  return (
    <span
      data-testid="lecture-badge"
      data-tone={tone}
      className={cn("shrink-0 rounded-xs px-1.5 py-0.5 text-micro", TONE_CLASS[tone])}
    >
      {label}
    </span>
  );
}

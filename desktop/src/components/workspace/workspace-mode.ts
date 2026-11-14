import type { ReadingEntry, UnitRows } from "~/domain/lectures";

export type WorkspaceMode = "overview" | "read" | "map" | "practice" | "ask";

export type WorkspaceLocation = {
  mode: WorkspaceMode;
  /** The digest file name open in Read, without `.md`. */
  digestSlug: string | null;
  practiceTab: "cards" | "quiz" | null;
};

/** Which workspace view a class path is. */
export function workspaceLocation(pathname: string): WorkspaceLocation {
  const parts = pathname.split("/").filter(Boolean);
  const [, , segment, rest] = parts;
  const slug = rest ? decodeURIComponent(rest) : null;
  switch (segment) {
    case "read":
      return { mode: "read", digestSlug: slug, practiceTab: null };
    case "map":
      return { mode: "map", digestSlug: null, practiceTab: null };
    case "practice":
      return { mode: "practice", digestSlug: null, practiceTab: rest === "quiz" ? "quiz" : "cards" };
    case "ask":
      return { mode: "ask", digestSlug: null, practiceTab: null };
    default:
      return { mode: "overview", digestSlug: null, practiceTab: null };
  }
}

/** Practice hides the lecture column and Ask swaps it for the Chats list. */
export function showsLectureColumn(mode: WorkspaceMode): boolean {
  return mode === "overview" || mode === "read" || mode === "map";
}

/**
 * The lecture the Read tab opens: the one opened most recently, else the newest lecture.
 * Returns the course-prefixed digest path, or null for a class with no digests.
 */
export function pickReadTarget(rows: UnitRows[], reading: Record<string, ReadingEntry>): string | null {
  const all = rows.flatMap((group) => group.lectures);
  if (all.length === 0) {
    return null;
  }
  let best: { digest: string; at: string } | null = null;
  for (const lecture of all) {
    const at = reading[lecture.digest]?.last_opened;
    if (at && (!best || at > best.at)) {
      best = { digest: lecture.digest, at };
    }
  }
  if (best) {
    return best.digest;
  }
  const newest = rows[0]?.lectures[rows[0].lectures.length - 1];
  return newest?.digest ?? all[0]!.digest;
}

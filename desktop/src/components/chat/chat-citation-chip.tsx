import { useNavigate } from "@tanstack/react-router";

import { Chip } from "~/components/app/chip";
import type { ChatCitation } from "~/domain/chat";
import { chatNotePath, formatChatCitationLabel } from "~/domain/chat";
import { resolveDigestSlug } from "~/domain/notes";
import type { DigestInfo } from "~/domain/types";
import { classPath } from "~/lib/class-path";

/** The Overview section a course-overview source opens when it names no heading of its own. */
const COURSE_NOTES_HEADING = "Course notes";

/** A lecture the list does not know, named from its file: "2026-10-01-ion-channels.md" -> "Ion channels". */
function lectureNameFromPath(digestPath: string): string {
  const base = (digestPath.replace(/\\/g, "/").split("/").pop() ?? digestPath)
    .replace(/\.md$/i, "")
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : digestPath;
}

/**
 * One source under an answer. A lecture opens in Read at the cited heading; the course overview
 * opens the Overview, which expands and scrolls to the cited heading of the course notes.
 */
export function ChatCitationChip({
  course,
  citation,
  digests,
}: {
  course: string;
  citation: ChatCitation;
  digests: DigestInfo[];
}) {
  const navigate = useNavigate();
  const digestPath = citation.digest_path ?? "";
  const notePath = chatNotePath(course, digestPath);
  const isOverview =
    notePath === `${course}/course.md` || notePath.endsWith("/course.md");

  return (
    <Chip
      variant="plain"
      className="h-4.25 border-info px-1 text-caption text-info hover:bg-accent"
      onClick={() => {
        if (isOverview) {
          void navigate({
            ...classPath(course, "overview"),
            search: { heading: citation.heading_id || COURSE_NOTES_HEADING },
          });
          return;
        }
        void navigate({
          ...classPath(course, "read", resolveDigestSlug(digestPath, digests)),
          search: citation.heading_id ? { heading: citation.heading_id } : {},
        });
      }}
    >
      {formatChatCitationLabel(
        citation,
        course,
        // Listed lectures come first and win; the last entry only names a lecture the list lacks.
        [...digests, { title: lectureNameFromPath(digestPath), date: "", path: digestPath }],
      )}
    </Chip>
  );
}

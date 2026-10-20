import { useNavigate } from "@tanstack/react-router";

import { Chip } from "~/components/app/chip";
import type { ChatCitation } from "~/domain/chat";
import { chatNotePath, formatChatCitationLabel } from "~/domain/chat";
import { resolveDigestSlug } from "~/domain/notes";
import type { DigestInfo } from "~/domain/types";

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
      onClick={() => {
        if (isOverview) {
          void navigate({ to: "/course/$course/notes", params: { course } });
          return;
        }
        const slug = resolveDigestSlug(digestPath, digests);
        void navigate({
          to: "/course/$course/notes/$digest",
          params: { course, digest: slug },
          search: citation.heading_id ? { heading: citation.heading_id } : {},
        });
      }}
    >
      {formatChatCitationLabel(citation, course, digests)}
    </Chip>
  );
}

import { useNavigate } from "@tanstack/react-router";
import type { MouseEvent } from "react";

import { Chip } from "~/components/app/chip";
import { formatFlashcardSourceLabel, resolveDigestSlug } from "~/domain/notes";
import type { CardSource, DigestInfo } from "~/domain/types";

export function StudySourceChip({
  course,
  source,
  digests,
  onClick,
}: {
  course: string;
  source: CardSource;
  digests: DigestInfo[];
  onClick?: (event: MouseEvent) => void;
}) {
  const navigate = useNavigate();
  return (
    <Chip
      variant="plain"
      onClick={(event) => {
        onClick?.(event);
        event.stopPropagation();
        const slug = resolveDigestSlug(source.digest, digests);
        void navigate({
          to: "/course/$course/notes/$digest",
          params: { course, digest: slug },
          search: source.heading ? { heading: source.heading } : {},
        });
      }}
    >
      {formatFlashcardSourceLabel(source, digests)}
    </Chip>
  );
}

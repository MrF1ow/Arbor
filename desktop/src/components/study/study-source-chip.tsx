import { useNavigate } from "@tanstack/react-router";
import type { MouseEvent } from "react";

import { Chip } from "~/components/app/chip";
import { classPath } from "~/lib/class-path";
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
      className="h-auto border-info px-1 text-micro text-info hover:bg-muted"
      onClick={(event) => {
        onClick?.(event);
        event.stopPropagation();
        const slug = resolveDigestSlug(source.digest, digests);
        void navigate({
          ...classPath(course, "read", slug),
          search: source.heading ? { heading: source.heading } : {},
        });
      }}
    >
      {formatFlashcardSourceLabel(source, digests)}
    </Chip>
  );
}

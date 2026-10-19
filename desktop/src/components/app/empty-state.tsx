import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

export function EmptyState({
  icon: Icon,
  media,
  title,
  description,
  actions,
}: {
  icon?: LucideIcon;
  media?: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        {media ? (
          <EmptyMedia variant="default">{media}</EmptyMedia>
        ) : Icon ? (
          <EmptyMedia variant="icon">
            <Icon className="size-icon text-muted-foreground" />
          </EmptyMedia>
        ) : null}
        <EmptyTitle className="text-2xl">{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {actions ? <EmptyContent>{actions}</EmptyContent> : null}
    </Empty>
  );
}

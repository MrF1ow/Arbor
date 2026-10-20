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
  titleClassName,
  description,
  actions,
}: {
  icon?: LucideIcon;
  media?: ReactNode;
  title: string;
  titleClassName?: string;
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
        <EmptyTitle className={titleClassName}>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {actions ? <EmptyContent>{actions}</EmptyContent> : null}
    </Empty>
  );
}

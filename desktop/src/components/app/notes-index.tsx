import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { House, ListCollapse, PanelLeftClose } from "lucide-react";
import { useRef, type RefObject } from "react";

import { ListRow } from "~/components/app/list-row";
import { SectionLabel } from "~/components/app/section-label";
import { IconButton } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { digestSlugFromPath } from "~/domain/notes";
import type { DigestInfo } from "~/domain/types";
import { useUiStore } from "~/stores/ui-store";
import { cn } from "~/lib/utils";

function DigestRows({
  digests,
  course,
  activeDigest,
  scrollRef,
}: {
  digests: DigestInfo[];
  course: string;
  activeDigest: string | null;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const navigate = useNavigate();
  const virtualize = digests.length > 100;
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual row sizing is intentional here.
  const virtualizer = useVirtualizer({
    count: digests.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 46,
    enabled: virtualize,
  });

  const renderRow = (digest: DigestInfo) => {
    const slug = digestSlugFromPath(digest.path);
    const active = activeDigest === slug;
    return (
      <ListRow
        key={digest.path}
        title={digest.title}
        meta={digest.date}
        twoLine
        active={active}
        className="w-full"
        onSelect={() => {
          void navigate({
            to: "/course/$course/notes/$digest",
            params: { course, digest: slug },
          });
        }}
      />
    );
  };

  if (!virtualize) {
    return <div className="flex flex-col gap-0.5">{digests.map(renderRow)}</div>;
  }

  return (
    <div
      className="relative w-full"
      style={{ height: `${virtualizer.getTotalSize()}px` }} // style-allow: virtual-list-height
    >
      {virtualizer.getVirtualItems().map((item) => {
        const digest = digests[item.index];
        return (
          <div
            key={digest.path}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${item.start}px)` }} // style-allow: virtual-row-offset
          >
            {renderRow(digest)}
          </div>
        );
      })}
    </div>
  );
}

export function NotesIndex({
  course,
  digests,
  loading,
  className,
  onHideIndex,
}: {
  course: string;
  digests: DigestInfo[] | undefined;
  loading: boolean;
  className?: string;
  onHideIndex?: () => void;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const setNotesIndexOpen = useUiStore((s) => s.setNotesIndexOpen);
  const hideIndex = onHideIndex ?? (() => setNotesIndexOpen(false));
  const navScrollRef = useRef<HTMLElement>(null);
  const onOverview = pathname.endsWith("/notes") || pathname.endsWith("/notes/");
  const activeDigest = onOverview
    ? null
    : pathname.split("/notes/")[1]?.split("/")[0] ?? null;

  return (
    <nav
      ref={navScrollRef}
      aria-label="Course index"
      className={cn(
        "flex h-full min-h-0 w-index shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-background px-2 py-2",
        className,
      )}
    >
      <SectionLabel
        className="px-1"
        action={
          <IconButton
            icon={PanelLeftClose}
            label="Hide index"
            size="icon-xs"
            variant="ghost"
            onClick={hideIndex}
          />
        }
      >
        Course
      </SectionLabel>
      <ListRow
        title="Overview"
        meta="Study plan · course map"
        icon={House}
        twoLine
        active={onOverview}
        className="w-full"
        onSelect={() => {
          void navigate({ to: "/course/$course/notes", params: { course } });
        }}
      />
      <SectionLabel className="px-1 pt-2">Digests</SectionLabel>
      {loading ? (
        <div className="space-y-1 px-1">
          <Skeleton className="h-row w-full" />
          <Skeleton className="h-row w-full" />
          <Skeleton className="h-row w-full" />
        </div>
      ) : (
        <DigestRows
          digests={digests ?? []}
          course={course}
          activeDigest={activeDigest}
          scrollRef={navScrollRef}
        />
      )}
    </nav>
  );
}

export function NotesIndexShowButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton
      icon={ListCollapse}
      label="Show index"
      size="icon-sm"
      variant="ghost"
      className="absolute left-3 top-3 z-floating"
      onClick={onClick}
    />
  );
}

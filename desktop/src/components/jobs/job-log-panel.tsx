import { useVirtualizer } from "@tanstack/react-virtual";
import { Copy } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { IconButton } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { Spinner } from "~/components/ui/spinner";
import { jobTitle } from "~/domain/jobs";
import type { JobEventRow, JobSummary } from "~/domain/types";
import { useStickToBottomScroll } from "~/hooks/use-stick-to-bottom-scroll";
import { modShortcut } from "~/lib/shortcuts";
import { cn } from "~/lib/utils";
import { useJobStore } from "~/stores/job-store";

export type LogLine = {
  key: string;
  prefix: string;
  text: string;
};

export function formatLogForClipboard(lines: LogLine[]): string {
  return lines.map((row) => (row.prefix ? `${row.prefix} ${row.text}` : row.text)).join("\n");
}

export async function copyLogLines(lines: LogLine[]): Promise<void> {
  try {
    await navigator.clipboard.writeText(formatLogForClipboard(lines));
    toast.success("Copied");
  } catch {
    toast.error("Couldn't copy log");
  }
}

/** Lines appended to the store after `cursor` (exclusive prefix). */
export function liveTailFromStore(storeLines: string[], cursor: number): string[] {
  return storeLines.slice(Math.max(0, cursor));
}

export function buildLogLines(
  events: JobEventRow[],
  liveTail: string[],
  jobId: string,
): LogLine[] {
  const fromDb = events.map((row, index) => ({
    key: `${jobId}-db-${index}`,
    prefix: row.created_at
      ? new Date(row.created_at).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "",
    text: row.line,
  }));
  const fromLive = liveTail.map((line, index) => ({
    key: `${jobId}-live-${index}`,
    prefix: "",
    text: line,
  }));
  return [...fromDb, ...fromLive];
}

export function JobLogPanel({
  job,
  scope,
  events,
  eventsLoading,
  eventsFetching,
  eventsDataUpdatedAt,
  className,
}: {
  job: JobSummary | null;
  /** The Scope column's label for the job ("Cell Biology · Unit 2 · 3 lectures"). */
  scope?: string | null;
  events: JobEventRow[] | undefined;
  eventsLoading: boolean;
  eventsFetching?: boolean;
  eventsDataUpdatedAt?: number;
  className?: string;
}) {
  const activeJobId = useJobStore((s) => s.activeJobId);
  const storeLines = useJobStore((s) => s.lines);

  const [lineCursor, setLineCursor] = useState(0);
  const [tailJobId, setTailJobId] = useState<string | null>(null);
  const [showPostFinishTail, setShowPostFinishTail] = useState(false);
  const prevActiveJobIdRef = useRef<string | null>(null);
  const activeTailInitializedRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeJobId && job?.id === activeJobId) {
      setTailJobId(activeJobId);
      if (activeTailInitializedRef.current !== activeJobId) {
        activeTailInitializedRef.current = activeJobId;
        setLineCursor(useJobStore.getState().lines.length);
      }
      setShowPostFinishTail(false);
    }
    if (!activeJobId) {
      activeTailInitializedRef.current = null;
    }
    const prevActive = prevActiveJobIdRef.current;
    if (prevActive && !activeJobId && job?.id === prevActive) {
      setShowPostFinishTail(true);
      setTailJobId(prevActive);
    }
    prevActiveJobIdRef.current = activeJobId;
  }, [activeJobId, job?.id]);

  useEffect(() => {
    if (!job?.id || events === undefined) {
      return;
    }
    setLineCursor(useJobStore.getState().lines.length);
    if (showPostFinishTail && tailJobId === job.id && !eventsFetching) {
      setShowPostFinishTail(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync cursor when refetched events land, not on every array reference
  }, [eventsDataUpdatedAt, eventsFetching, job?.id, showPostFinishTail, tailJobId]);

  let liveTail: string[] = [];
  if (job && tailJobId === job.id) {
    const delta = liveTailFromStore(storeLines, lineCursor);
    if (activeJobId === job.id || showPostFinishTail) {
      liveTail = delta;
    }
  }

  const lines = job == null ? [] : buildLogLines(events ?? [], liveTail, job.id);

  const { scrollRef, onScroll, stickToBottomRef } = useStickToBottomScroll(lines.length);

  // eslint-disable-next-line react-hooks/incompatible-library -- virtualizer row offsets are imperative
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 18,
    overscan: 16,
  });

  useLayoutEffect(() => {
    if (!stickToBottomRef.current || lines.length === 0) {
      return;
    }
    if (lines.length > 200) {
      virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
      return;
    }
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollRef is stable; stickiness reads scroll height imperatively
  }, [lines.length, virtualizer, stickToBottomRef]);

  if (!job) {
    return (
      <div
        className={cn(
          "flex min-h-48 flex-1 items-center justify-center rounded-lg border border-border bg-muted p-6 text-small text-muted-foreground",
          className,
        )}
      >
        Select a job to view its log.
      </div>
    );
  }

  const heading = ["Log", jobTitle(job.trigger_kind, job.skill), scope && scope !== "—" ? scope : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-hidden rounded-lg border border-border bg-muted p-4",
        className,
      )}
      data-testid="job-log-panel"
    >
      <div className="flex shrink-0 items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-small font-semibold">{heading}</h3>
        <IconButton
          icon={Copy}
          label="Copy log"
          size="icon-sm"
          variant="ghost"
          tooltip={false}
          data-testid="copy-job-log"
          onClick={() => void copyLogLines(lines)}
        />
        <Kbd className="border-transparent bg-transparent text-kbd">{modShortcut("`")}</Kbd>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-48 flex-1 overflow-auto font-mono text-kbd text-muted-foreground"
      >
        {eventsLoading && lines.length === 0 ? (
          <div className="flex items-center gap-2 py-4 text-small">
            <Spinner className="size-icon-sm" />
            Loading log…
          </div>
        ) : null}
        {!eventsLoading && lines.length === 0 ? (
          <p className="py-4 text-small text-muted-foreground">No log lines for this job.</p>
        ) : null}
        {lines.length > 0 && lines.length <= 200
          ? lines.map((row) => (
              <div key={row.key} className="whitespace-pre-wrap break-words">
                {row.prefix ? (
                  <span className="mr-2 text-faint-foreground">{row.prefix}</span>
                ) : null}
                <span className="text-foreground">{row.text}</span>
              </div>
            ))
          : null}
        {lines.length > 200 ? (
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }} // style-allow: virtualizer total height
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = lines[item.index]!;
              return (
                <div
                  key={row.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute inset-x-0 whitespace-pre-wrap break-words"
                  style={{ transform: `translateY(${item.start}px)` }} // style-allow: virtualizer row offset
                >
                  {row.prefix ? (
                    <span className="mr-2 text-faint-foreground">{row.prefix}</span>
                  ) : null}
                  <span className="text-foreground">{row.text}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

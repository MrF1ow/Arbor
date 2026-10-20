import { useVirtualizer } from "@tanstack/react-virtual";
import { Copy, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, IconButton } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import {
  formatDuration,
  jobKindLabel,
  relativeTime,
} from "~/domain/jobs";
import type { JobEventRow, JobSummary } from "~/domain/types";
import { useStickToBottomScroll } from "~/hooks/use-stick-to-bottom-scroll";
import { useCancelUpdateMutation } from "~/lib/queries/jobs";
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

function jobStatusLabel(status: string): string {
  if (status === "succeeded") {
    return "Succeeded";
  }
  if (status === "failed") {
    return "Failed";
  }
  if (status === "cancelled") {
    return "Cancelled";
  }
  if (status === "running") {
    return "Running";
  }
  return status;
}

export function JobLogPanel({
  job,
  events,
  eventsLoading,
  eventsFetching,
  eventsDataUpdatedAt,
  nowMs,
}: {
  job: JobSummary | null;
  events: JobEventRow[] | undefined;
  eventsLoading: boolean;
  eventsFetching?: boolean;
  eventsDataUpdatedAt?: number;
  nowMs: number;
}) {
  const activeJobId = useJobStore((s) => s.activeJobId);
  const activeUpdateJobId = useJobStore((s) => s.activeUpdateJobId);
  const storeLines = useJobStore((s) => s.lines);
  const cancelUpdate = useCancelUpdateMutation();

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

  const showCancel =
    job?.status === "running" &&
    job.id === activeUpdateJobId &&
    activeUpdateJobId != null;

  if (!job) {
    return (
      <div className="flex min-h-48 flex-1 items-center justify-center rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
        Select a job to view its log.
      </div>
    );
  }

  const duration = formatDuration(job.started_at, job.finished_at);
  const startedRelative = relativeTime(job.started_at, nowMs);

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card"
      data-testid="job-log-panel"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {jobKindLabel(job.trigger_kind, job.skill)}
          </p>
          <p className="text-2xs text-muted-foreground">
            {jobStatusLabel(job.status)} · {startedRelative} · {duration}
          </p>
        </div>
        {showCancel ? (
          <Button
            variant="outline"
            size="sm"
            className="border-destructive text-destructive hover:bg-destructive-surface"
            onClick={() => void cancelUpdate.mutateAsync()}
          >
            <X className="size-icon-sm" />
            Cancel
          </Button>
        ) : null}
        <IconButton
          icon={Copy}
          label="Copy log"
          size="icon-sm"
          variant="ghost"
          tooltip={false}
          data-testid="copy-job-log"
          onClick={() => void copyLogLines(lines)}
        />
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-48 flex-1 overflow-auto px-4 py-2 font-mono text-2xs text-muted-foreground"
      >
        {eventsLoading && lines.length === 0 ? (
          <div className="flex items-center gap-2 py-4 text-sm">
            <Spinner className="size-icon-sm" />
            Loading log…
          </div>
        ) : null}
        {!eventsLoading && lines.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No log lines for this job.</p>
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

export function JobStatusDot({ status, className }: { status: string; className?: string }) {
  if (status === "running") {
    return <Spinner className={cn("size-icon-sm shrink-0 text-primary", className)} />;
  }
  const color =
    status === "succeeded"
      ? "bg-success"
      : status === "failed"
        ? "bg-destructive"
        : "bg-muted-foreground";
  return <span className={cn("size-1.5 shrink-0 rounded-full", color, className)} aria-hidden />;
}

export function jobStatusTextClass(status: string): string {
  if (status === "running") {
    return "text-primary";
  }
  if (status === "succeeded") {
    return "text-success";
  }
  if (status === "failed") {
    return "text-destructive";
  }
  return "text-muted-foreground";
}

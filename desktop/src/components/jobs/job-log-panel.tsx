import { useVirtualizer } from "@tanstack/react-virtual";
import { Copy, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import { Button, IconButton } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import {
  formatDuration,
  jobKindLabel,
  relativeTime,
} from "~/domain/jobs";
import type { JobEventRow, JobSummary } from "~/domain/types";
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
  await navigator.clipboard.writeText(formatLogForClipboard(lines));
  toast.success("Copied");
}

function buildLogLines(
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
  nowMs,
}: {
  job: JobSummary | null;
  events: JobEventRow[] | undefined;
  eventsLoading: boolean;
  nowMs: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeJobId = useJobStore((s) => s.activeJobId);
  const activeUpdateJobId = useJobStore((s) => s.activeUpdateJobId);
  const storeLines = useJobStore((s) => s.lines);
  const cancelUpdate = useCancelUpdateMutation();

  const lines = useMemo(() => {
    if (!job) {
      return [];
    }
    const liveTail =
      job.status === "running" && job.id === activeJobId ? storeLines : [];
    return buildLogLines(events ?? [], liveTail, job.id);
  }, [activeJobId, events, job, storeLines]);

  // eslint-disable-next-line react-hooks/incompatible-library -- virtualizer row offsets are imperative
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 18,
    overscan: 16,
  });

  useEffect(() => {
    if (lines.length === 0) {
      return;
    }
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom) {
      virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
    }
  }, [lines.length, virtualizer]);

  const onCopy = async () => {
    await copyLogLines(lines);
  };

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
          <p className="truncate text-sm font-medium">{jobKindLabel(job.trigger_kind)}</p>
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
          onClick={() => void onCopy()}
        />
      </div>
      <div
        ref={scrollRef}
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

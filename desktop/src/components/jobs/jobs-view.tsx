import { useVirtualizer } from "@tanstack/react-virtual";
import { FolderOpen, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "~/components/app/empty-state";
import { SettingsSection } from "~/components/app/settings-section";
import { ShellPageHeader } from "~/components/app/shell-page-header";
import {
  JobLogPanel,
  JobStatusDot,
  jobStatusTextClass,
} from "~/components/jobs/job-log-panel";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { LazyTooltip, LazyTooltipContent, LazyTooltipTrigger } from "~/components/ui/lazy-tooltip";
import {
  formatDuration,
  formatJobTimestamp,
  jobKindLabel,
  relativeTime,
} from "~/domain/jobs";
import type { JobSummary } from "~/domain/types";
import { useChooseKnowledgeFolder } from "~/lib/hooks/use-choose-knowledge-folder";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useJobEvents, useJobs } from "~/lib/queries/jobs";
import { useSettings } from "~/lib/queries/settings";
import { cn } from "~/lib/utils";
import { useJobStore } from "~/stores/job-store";

function sortJobs(jobs: JobSummary[], activeJobId: string | null): JobSummary[] {
  if (!activeJobId) {
    return jobs;
  }
  const index = jobs.findIndex((j) => j.id === activeJobId);
  if (index <= 0) {
    return jobs;
  }
  const copy = jobs.slice();
  const [active] = copy.splice(index, 1);
  if (active) {
    copy.unshift(active);
  }
  return copy;
}

function JobListRow({
  job,
  active,
  selected,
  nowMs,
  onSelect,
}: {
  job: JobSummary;
  active: boolean;
  selected: boolean;
  nowMs: number;
  onSelect: () => void;
}) {
  const label = jobKindLabel(job.trigger_kind);
  const started = relativeTime(job.started_at, nowMs);
  const duration = formatDuration(job.started_at, job.finished_at);
  const statusLabel =
    job.status === "succeeded"
      ? "Succeeded"
      : job.status === "failed"
        ? "Failed"
        : job.status === "cancelled"
          ? "Cancelled"
          : "Running";

  return (
    <button
      type="button"
      className={cn(
        "relative flex w-full flex-col gap-0.5 px-2 py-2 text-left outline-none transition-colors duration-fast ease-out-soft",
        "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-transparent",
        selected && "before:bg-primary bg-transparent",
        !selected && "hover:bg-muted",
        active && !selected && "bg-accent",
      )}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      data-testid={`job-row-${job.id}`}
    >
      <span className="flex min-w-0 items-center gap-2 pr-1">
        <JobStatusDot status={job.status} />
        <span className={cn("shrink-0 text-2xs font-medium capitalize", jobStatusTextClass(job.status))}>
          {statusLabel}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        <LazyTooltip>
          <LazyTooltipTrigger
            render={(tooltipProps) => (
              <span
                {...tooltipProps}
                className="shrink-0 text-2xs text-faint-foreground tabular-nums"
              >
                {started}
              </span>
            )}
          />
          <LazyTooltipContent>{formatJobTimestamp(job.started_at)}</LazyTooltipContent>
        </LazyTooltip>
        <span className="shrink-0 text-2xs text-faint-foreground tabular-nums">{duration}</span>
      </span>
      {job.model_id ? (
        <span className="truncate pl-5 text-2xs text-faint-foreground">{job.model_id}</span>
      ) : null}
      {job.error_summary ? (
        <span className="truncate pl-5 text-2xs text-destructive">{job.error_summary}</span>
      ) : null}
    </button>
  );
}

function JobList({
  jobs,
  selectedId,
  activeJobId,
  nowMs,
  onSelect,
}: {
  jobs: JobSummary[];
  selectedId: string | null;
  activeJobId: string | null;
  nowMs: number;
  onSelect: (id: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualize = jobs.length > 50;

  // eslint-disable-next-line react-hooks/incompatible-library -- virtualizer row offsets are imperative
  const virtualizer = useVirtualizer({
    count: jobs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 8,
  });

  if (!virtualize) {
    return (
      <div className="flex min-h-0 flex-col divide-y divide-border overflow-y-auto">
        {jobs.map((job) => (
          <JobListRow
            key={job.id}
            job={job}
            active={job.id === activeJobId}
            selected={job.id === selectedId}
            nowMs={nowMs}
            onSelect={() => onSelect(job.id)}
          />
        ))}
      </div>
    );
  }

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
      <div
        style={{ height: virtualizer.getTotalSize(), position: "relative" }} // style-allow: virtualizer total height
      >
        {virtualizer.getVirtualItems().map((item) => {
          const job = jobs[item.index]!;
          return (
            <div
              key={job.id}
              className="absolute inset-x-0 border-b border-border"
              style={{ transform: `translateY(${item.start}px)` }} // style-allow: virtualizer row offset
            >
              <JobListRow
                job={job}
                active={job.id === activeJobId}
                selected={job.id === selectedId}
                nowMs={nowMs}
                onSelect={() => onSelect(job.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function JobsView({
  jobParam,
  onJobParamSync,
}: {
  jobParam?: string;
  onJobParamSync: (jobId: string | undefined) => void;
}) {
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const jobsQuery = useJobs(activeRoot);
  const activeJobId = useJobStore((s) => s.activeJobId);
  const { chooseFolder, isPending: choosingFolder } = useChooseKnowledgeFolder();
  const [nowMs] = useState(() => Date.now());

  const sortedJobs = useMemo(
    () => sortJobs(jobsQuery.data ?? [], activeJobId),
    [jobsQuery.data, activeJobId],
  );

  const selectedId = useMemo(() => {
    if (sortedJobs.length === 0) {
      return null;
    }
    if (jobParam && sortedJobs.some((j) => j.id === jobParam)) {
      return jobParam;
    }
    return sortedJobs[0]!.id;
  }, [jobParam, sortedJobs]);

  useEffect(() => {
    if (jobsQuery.isSuccess && sortedJobs.length === 0 && jobParam) {
      onJobParamSync(undefined);
    }
  }, [jobParam, jobsQuery.isSuccess, onJobParamSync, sortedJobs.length]);

  useEffect(() => {
    if (!jobsQuery.isSuccess || sortedJobs.length === 0) {
      return;
    }
    const effective =
      jobParam && sortedJobs.some((j) => j.id === jobParam) ? jobParam : sortedJobs[0]!.id;
    if (jobParam !== effective) {
      onJobParamSync(effective);
    }
  }, [jobParam, jobsQuery.isSuccess, onJobParamSync, sortedJobs]);

  const eventsQuery = useJobEvents(activeRoot, selectedId);

  const onSelectJob = (id: string) => {
    onJobParamSync(id);
  };

  const onRefresh = () => {
    void jobsQuery.refetch();
    if (selectedId) {
      void eventsQuery.refetch();
    }
  };

  const selectedJob = sortedJobs.find((j) => j.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6" data-testid="jobs-view">
      <ShellPageHeader
        title="Jobs"
        description="Recent runs from your Knowledge folder."
        actions={
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={!activeRoot || jobsQuery.isFetching}>
            <RefreshCw className={cn("size-icon-sm", jobsQuery.isFetching && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {!activeRoot ? (
        <EmptyState
          icon={FolderOpen}
          title="No Knowledge folder selected"
          actions={
            <Button variant="default" disabled={choosingFolder} onClick={() => void chooseFolder()}>
              Choose Knowledge folder…
            </Button>
          }
        />
      ) : jobsQuery.isLoading ? (
        <Skeleton className="h-48 w-full max-w-jobs" />
      ) : jobsQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Could not load jobs: {String(jobsQuery.error)}
        </p>
      ) : sortedJobs.length === 0 ? (
        <EmptyState title="No runs yet" />
      ) : (
        <div className="mx-auto flex w-full max-w-jobs min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch">
          <SettingsSection title="Recent runs" className="min-h-0 min-w-0 flex-1 lg:max-w-md">
            <div className="flex min-h-48 flex-col lg:max-h-jobs-pane">
              <JobList
                jobs={sortedJobs}
                selectedId={selectedId}
                activeJobId={activeJobId}
                nowMs={nowMs}
                onSelect={onSelectJob}
              />
            </div>
          </SettingsSection>
          <JobLogPanel
            job={selectedJob}
            events={eventsQuery.data}
            eventsLoading={eventsQuery.isLoading}
            nowMs={nowMs}
          />
        </div>
      )}
    </div>
  );
}

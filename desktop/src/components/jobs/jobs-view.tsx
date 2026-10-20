import { useVirtualizer } from "@tanstack/react-virtual";
import { FolderOpen, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";

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
import { useNow } from "~/hooks/use-now";
import { useChooseKnowledgeFolder } from "~/lib/hooks/use-choose-knowledge-folder";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useJobEvents, useJobs } from "~/lib/queries/jobs";
import { useSettings } from "~/lib/queries/settings";
import { cn } from "~/lib/utils";
import { useJobStore } from "~/stores/job-store";

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
  const label = jobKindLabel(job.trigger_kind, job.skill);
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
        (selected || active) && "before:bg-primary",
        selected && "bg-transparent",
        !selected && "hover:bg-muted",
        active && !selected && "bg-accent",
      )}
      aria-current={selected ? "true" : undefined}
      aria-label={`${label}, ${statusLabel}`}
      onClick={onSelect}
      data-testid={`job-row-${job.id}`}
    >
      <span className="flex min-w-0 items-center gap-2 pr-1">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
        <JobStatusDot status={job.status} />
        <span className={cn("shrink-0 text-2xs capitalize", jobStatusTextClass(job.status))}>
          {statusLabel}
        </span>
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
        <span className="truncate text-2xs text-faint-foreground">{job.model_id}</span>
      ) : null}
      {job.status === "failed" && job.error_summary ? (
        <LazyTooltip>
          <LazyTooltipTrigger
            render={(tooltipProps) => (
              <span
                {...tooltipProps}
                className="truncate text-2xs text-destructive"
              >
                {job.error_summary}
              </span>
            )}
          />
          <LazyTooltipContent className="max-w-sm">{job.error_summary}</LazyTooltipContent>
        </LazyTooltip>
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
      <div
        className="flex flex-col divide-y divide-border jobs:min-h-0 jobs:flex-1 jobs:overflow-y-auto"
        data-testid="job-list-scroll"
      >
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
              data-index={item.index}
              ref={virtualizer.measureElement}
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
  const nowMs = useNow();

  const jobRows = jobsQuery.data;
  const jobCount = jobRows?.length ?? 0;

  const selectedId = (() => {
    if (!jobRows || jobRows.length === 0) {
      return null;
    }
    if (jobParam && jobRows.some((j) => j.id === jobParam)) {
      return jobParam;
    }
    return jobRows[0]!.id;
  })();

  useEffect(() => {
    if (jobsQuery.isSuccess && jobCount === 0 && jobParam) {
      onJobParamSync(undefined);
    }
  }, [jobParam, jobCount, jobsQuery.isSuccess, onJobParamSync]);

  useEffect(() => {
    if (!jobsQuery.isSuccess || !jobRows || jobRows.length === 0) {
      return;
    }
    const effective =
      jobParam && jobRows.some((j) => j.id === jobParam) ? jobParam : jobRows[0]!.id;
    if (jobParam !== effective) {
      onJobParamSync(effective);
    }
  }, [jobParam, jobRows, jobsQuery.isSuccess, onJobParamSync]);

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

  const selectedJob = jobRows?.find((j) => j.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-6" data-testid="jobs-view">
      <div className="mx-auto flex w-full max-w-4xl min-h-0 flex-1 flex-col gap-6">
        <ShellPageHeader
          title="Jobs"
          description="Job history from your Knowledge folder."
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
          <Skeleton className="h-48 w-full" />
        ) : jobsQuery.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Could not load jobs: {String(jobsQuery.error)}
          </p>
        ) : jobCount === 0 ? (
          <EmptyState title="No runs yet" />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 jobs:flex-row jobs:items-stretch">
            <SettingsSection title="Recent runs" className="min-w-0 jobs:min-h-0 jobs:flex-1 jobs:max-w-md">
              <div
                className="flex flex-col jobs:min-h-0 jobs:max-h-jobs-pane jobs:flex-1"
                data-testid="job-list-container"
              >
                <JobList
                  jobs={jobRows ?? []}
                  selectedId={selectedId}
                  activeJobId={activeJobId}
                  nowMs={nowMs}
                  onSelect={onSelectJob}
                />
              </div>
            </SettingsSection>
            <JobLogPanel
              className="min-h-80 jobs:min-h-0"
              job={selectedJob}
              events={eventsQuery.data}
              eventsLoading={eventsQuery.isLoading}
              eventsFetching={eventsQuery.isFetching}
              eventsDataUpdatedAt={eventsQuery.dataUpdatedAt}
              nowMs={nowMs}
            />
          </div>
        )}
      </div>
    </div>
  );
}

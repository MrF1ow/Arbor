import { useQueries } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "~/components/app/empty-state";
import { JobLogPanel } from "~/components/jobs/job-log-panel";
import { Button } from "~/components/ui/button";
import { LazyTooltip, LazyTooltipContent, LazyTooltipTrigger } from "~/components/ui/lazy-tooltip";
import { Skeleton } from "~/components/ui/skeleton";
import {
  type DigestUnitsByCourse,
  formatDuration,
  formatJobTimestamp,
  jobScopeLabel,
  jobStartedLabel,
  jobStatusCounts,
  jobTitle,
} from "~/domain/jobs";
import type { DigestInfo, JobSummary } from "~/domain/types";
import { useNow } from "~/hooks/use-now";
import { useChooseKnowledgeFolder } from "~/lib/hooks/use-choose-knowledge-folder";
import { invoke } from "~/lib/ipc";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useCancelUpdateMutation, useJobEvents, useJobs } from "~/lib/queries/jobs";
import { qk } from "~/lib/queries/keys";
import { useOpenClass } from "~/lib/open-class";
import { useSettings } from "~/lib/queries/settings";
import { cn } from "~/lib/utils";
import { useJobStore } from "~/stores/job-store";

type StatusFilter = "all" | "running" | "failed" | "succeeded";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "failed", label: "Failed" },
  { key: "succeeded", label: "Succeeded" },
];

const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  failed: "Failed",
  succeeded: "Succeeded",
  cancelled: "Cancelled",
};

const STATUS_TAG_CLASS: Record<string, string> = {
  running: "bg-muted text-muted-foreground",
  failed: "bg-destructive-surface text-destructive",
  succeeded: "bg-accent text-success",
  cancelled: "bg-muted text-muted-foreground",
};

/** `list_digests` for each class the jobs touched, so the Scope column can name a lecture's unit (Q30). */
function useDigestUnits(root: string | null, jobs: JobSummary[] | undefined): DigestUnitsByCourse {
  const courses = useMemo(
    () => [...new Set((jobs ?? []).map((job) => job.course).filter((course): course is string => Boolean(course)))],
    [jobs],
  );
  const results = useQueries({
    queries: courses.map((course) => ({
      queryKey: qk.digests(root ?? "", course),
      enabled: Boolean(root),
      queryFn: () => invoke<DigestInfo[]>("list_digests", { root: root!, course }),
    })),
  });
  const byCourse: DigestUnitsByCourse = {};
  courses.forEach((course, index) => {
    byCourse[course] = (results[index]?.data ?? []).map((d) => ({ path: d.path, unit: d.unit ?? null }));
  });
  return byCourse;
}

function FilterChip({
  label,
  count,
  pressed,
  onClick,
}: {
  label: string;
  count: number;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-6.25 items-center rounded-full border px-2.5 text-caption outline-none transition-colors duration-fast ease-out-soft focus-visible:ring-2 focus-visible:ring-ring",
        pressed
          ? "border-accent bg-accent text-accent-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      {label} {count}
    </button>
  );
}

function StatusTag({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4.25 items-center rounded-xs px-1.5 text-micro",
        STATUS_TAG_CLASS[status] ?? STATUS_TAG_CLASS.cancelled,
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** The running job's bar: the update run's position when known, else a pulse. */
function RunBar({ jobId }: { jobId: string }) {
  const activeJobId = useJobStore((s) => s.activeJobId);
  const progress = useJobStore((s) => s.progress);
  const share =
    activeJobId === jobId && progress && progress.total > 0
      ? Math.min(1, Math.max(0, progress.index / progress.total))
      : null;
  return (
    <div
      role="progressbar"
      aria-label="Job progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={share === null ? undefined : Math.round(share * 100)}
      className="h-0.75 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn("h-full rounded-full bg-primary", share === null && "w-full animate-pulse")}
        style={share === null ? undefined : { width: `${share * 100}%` }} // style-allow: progress share
      />
    </div>
  );
}

function JobResult({ job }: { job: JobSummary }) {
  if (job.status === "running") {
    return <RunBar jobId={job.id} />;
  }
  if (job.status === "failed") {
    return (
      <LazyTooltip>
        <LazyTooltipTrigger
          render={(tooltipProps) => (
            <span {...tooltipProps} className="block truncate text-destructive">
              {job.error_summary ?? "Failed"}
            </span>
          )}
        />
        <LazyTooltipContent className="max-w-sm">{job.error_summary ?? "Failed"}</LazyTooltipContent>
      </LazyTooltip>
    );
  }
  if (job.status === "succeeded") {
    return <span>{formatDuration(job.started_at, job.finished_at)}</span>;
  }
  if (job.status === "cancelled" && job.error_summary) {
    // A job Arbor ended on its own (it closed before the job finished) says why.
    return (
      <LazyTooltip>
        <LazyTooltipTrigger
          render={(tooltipProps) => (
            <span {...tooltipProps} className="block truncate text-muted-foreground">
              {job.error_summary}
            </span>
          )}
        />
        <LazyTooltipContent className="max-w-sm">{job.error_summary}</LazyTooltipContent>
      </LazyTooltip>
    );
  }
  return <span>—</span>;
}

function JobRow({
  job,
  scope,
  selected,
  nowMs,
  canCancel,
  onSelect,
  onOpenClass,
}: {
  job: JobSummary;
  scope: string;
  selected: boolean;
  nowMs: number;
  canCancel: boolean;
  onSelect: () => void;
  onOpenClass: (course: string) => void;
}) {
  const cancelUpdate = useCancelUpdateMutation();
  const title = jobTitle(job.trigger_kind, job.skill);
  return (
    <tr
      data-testid={`job-row-${job.id}`}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "cursor-pointer border-b border-border transition-colors duration-fast ease-out-soft last:border-b-0",
        selected ? "bg-selected" : "hover:bg-muted",
      )}
    >
      <td className="px-4 py-3 align-middle">
        <StatusTag status={job.status} />
      </td>
      <td className="px-3 py-3 align-middle text-small font-semibold">
        <button
          type="button"
          className="text-left outline-none focus-visible:underline"
          aria-label={`${title}, ${STATUS_LABEL[job.status] ?? job.status}`}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          {title}
        </button>
      </td>
      <td data-column="scope" className="min-w-0 px-3 py-3 align-middle text-small text-muted-foreground">
        {job.course ? (
          <button
            type="button"
            className="text-left outline-none hover:text-foreground hover:underline focus-visible:underline"
            onClick={(event) => {
              event.stopPropagation();
              onOpenClass(job.course!);
            }}
          >
            {scope}
          </button>
        ) : (
          <span>{scope}</span>
        )}
      </td>
      <td className="px-3 py-3 align-middle text-caption whitespace-nowrap text-muted-foreground">
        <LazyTooltip>
          <LazyTooltipTrigger
            render={(tooltipProps) => <span {...tooltipProps}>{jobStartedLabel(job.started_at, nowMs)}</span>}
          />
          <LazyTooltipContent>{formatJobTimestamp(job.started_at)}</LazyTooltipContent>
        </LazyTooltip>
      </td>
      <td className="px-3 py-3 align-middle text-caption text-muted-foreground">
        <JobResult job={job} />
      </td>
      <td className="px-4 py-2 text-right align-middle">
        {job.status === "running" && canCancel ? (
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              void cancelUpdate.mutateAsync();
            }}
          >
            Cancel
          </Button>
        ) : (
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-caption text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
          >
            Log
          </button>
        )}
      </td>
    </tr>
  );
}

const HEADERS = ["Status", "Job", "Scope", "Started", "Result"];

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
  const activeUpdateJobId = useJobStore((s) => s.activeUpdateJobId);
  const { chooseFolder, isPending: choosingFolder } = useChooseKnowledgeFolder();
  const openClass = useOpenClass();
  const nowMs = useNow();
  const [filter, setFilter] = useState<StatusFilter>("all");

  const jobRows = jobsQuery.data;
  const jobCount = jobRows?.length ?? 0;
  const counts = jobStatusCounts(jobRows ?? []);
  const visible = (jobRows ?? []).filter((job) => filter === "all" || job.status === filter);
  const units = useDigestUnits(activeRoot, jobRows);
  const scopeOf = (job: JobSummary) =>
    jobScopeLabel({ course: job.course ?? null, digests: job.digests ?? null }, units);

  // The log always belongs to a listed row: a filter that hides the picked job hands the
  // selection to the first job it still lists, or to none.
  const selectedId = (() => {
    if (visible.length === 0) {
      return null;
    }
    if (jobParam && visible.some((j) => j.id === jobParam)) {
      return jobParam;
    }
    return visible[0]!.id;
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
    if (selectedId && jobParam !== selectedId) {
      onJobParamSync(selectedId);
    }
  }, [jobParam, jobRows, jobsQuery.isSuccess, selectedId, onJobParamSync]);

  // The table is capped, so a picked job's log can sit below the fold: bring it into view
  // when a row is picked and for a `?job=` deep link.
  const logRef = useRef<HTMLDivElement>(null);
  const showLog = () => logRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  const deepLink = useRef(jobParam);
  useEffect(() => {
    if (!jobsQuery.isSuccess || !deepLink.current) {
      return;
    }
    deepLink.current = undefined;
    logRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [jobsQuery.isSuccess]);

  const eventsQuery = useJobEvents(activeRoot, selectedId);
  const selectedJob = jobRows?.find((j) => j.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-6" data-testid="jobs-view">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-title font-medium">Jobs</h2>
        <p className="text-caption text-muted-foreground">Job history from your Knowledge folder.</p>
      </header>

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
        <p className="text-small text-destructive" role="alert">
          Could not load jobs: {String(jobsQuery.error)}
        </p>
      ) : jobCount === 0 ? (
        <EmptyState title="No runs yet" />
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap gap-1.5" role="group" aria-label="Filter jobs by status">
            {FILTERS.map(({ key, label }) => (
              <FilterChip
                key={key}
                label={label}
                count={counts[key]}
                pressed={filter === key}
                onClick={() => setFilter(key)}
              />
            ))}
          </div>

          <div
            className="max-h-jobs-pane shrink-0 overflow-y-auto rounded-lg border border-border bg-card"
            data-testid="job-list-container"
          >
            <table className="w-full table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-26" />
                <col className="w-40" />
                <col />
                <col className="w-22" />
                <col className="w-28" />
                <col className="w-16" />
              </colgroup>
              <thead>
                <tr className="sticky top-0 z-dropdown bg-muted">
                  {HEADERS.map((header) => (
                    <th
                      key={header}
                      scope="col"
                      className="px-3 py-2.5 text-label font-semibold tracking-wider text-faint-foreground first:px-4"
                    >
                      {header}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    scope={scopeOf(job)}
                    selected={job.id === selectedId}
                    nowMs={nowMs}
                    canCancel={job.id === activeUpdateJobId}
                    onSelect={() => {
                      onJobParamSync(job.id);
                      showLog();
                    }}
                    onOpenClass={(course) => void openClass(activeRoot, course, "overview")}
                  />
                ))}
              </tbody>
            </table>
            {visible.length === 0 ? (
              <p className="px-4 py-6 text-center text-small text-muted-foreground">
                No {filter} jobs
              </p>
            ) : null}
          </div>

          <div ref={logRef} className="flex max-h-jobs-pane min-h-48 shrink-0 flex-col">
            <JobLogPanel
              className="min-h-48"
              job={selectedJob}
              scope={selectedJob ? scopeOf(selectedJob) : null}
              events={eventsQuery.data}
              eventsLoading={eventsQuery.isLoading}
              eventsFetching={eventsQuery.isFetching}
              eventsDataUpdatedAt={eventsQuery.dataUpdatedAt}
            />
          </div>
        </>
      )}
    </div>
  );
}

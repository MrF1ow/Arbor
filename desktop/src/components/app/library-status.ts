import { runningJobStatusLabel } from "~/domain/job-labels";
import { jobKindLabel } from "~/domain/jobs";
import type { JobProgress, JobStoreStatus } from "~/stores/job-store";

export type LibraryStatusVariant = "idle" | "running" | "failed" | "none";

export type LibraryStatus = {
  variant: LibraryStatusVariant;
  label: string;
  /** The job the pill's menu should open in Jobs, when there is one worth looking at. */
  jobId?: string;
};

export type LibraryStatusInput = {
  /** False in a plain browser: there is no worker to talk to. */
  desktop: boolean;
  /** False when no Knowledge folder is chosen at all. */
  hasRoot: boolean;
  jobStatus: JobStoreStatus;
  step: string | null;
  label: string | null;
  progress: JobProgress | null;
  /** The library's name when the running job belongs to a library other than the active one (Q24). */
  jobLibrary: string | null;
  lastFinishedJobId: string | null;
  /**
   * True when the job the store last finished belongs to another library than the active one:
   * its failure says nothing about this library, so it never turns the pill red or gives it a job link.
   */
  finishedElsewhere: boolean;
  /** The newest row of the active library's jobs list. */
  latestJob: {
    id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    skill?: string | null;
  } | null;
  /** The job the store last finished, when the jobs list has it: its skill says what kind it was. */
  lastFinishedJob?: { skill?: string | null } | null;
  nowMs: number;
};

/** "2h ago": the design's short relative time (`relativeTime` in domain/jobs spells it out). */
export function compactAgo(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return iso;
  }
  const seconds = Math.floor(Math.max(0, nowMs - then) / 1000);
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * "Last update failed" for an update, "Last citations job failed" for a study job, and
 * "Last job failed" when the job's kind is not known. A job with no skill is an update.
 */
function failedLabel(job: { skill?: string | null } | null | undefined): string {
  if (!job) {
    return "Last job failed";
  }
  const skill = job.skill?.trim();
  if (!skill) {
    return "Last update failed";
  }
  const kind = jobKindLabel("", skill).trim().toLowerCase();
  return kind ? `Last ${kind} job failed` : "Last job failed";
}

/**
 * What the top bar's library pill says: up to date (with its age), "Updating 2 of 3 · <step>",
 * failed, or No Knowledge folder. The job store wins while a job runs in this window; the jobs
 * list covers a job that was already running or failed when the app loaded.
 */
export function libraryStatus(input: LibraryStatusInput): LibraryStatus {
  if (!input.desktop) {
    return { variant: "none", label: "Desktop app required" };
  }
  if (!input.hasRoot) {
    return { variant: "none", label: "No Knowledge folder" };
  }
  const { latestJob } = input;
  const jobStatus = input.jobStatus === "failed" && input.finishedElsewhere ? "idle" : input.jobStatus;

  if (jobStatus === "running") {
    const from = input.jobLibrary ? `${input.jobLibrary} · ` : "";
    if (input.progress) {
      const position = `Updating ${Math.max(1, input.progress.index)} of ${input.progress.total}`;
      if (input.jobLibrary) {
        return { variant: "running", label: `${from}${position}` };
      }
      return { variant: "running", label: input.step ? `${position} · ${input.step}` : position };
    }
    return { variant: "running", label: `${from}${runningJobStatusLabel(input.step, input.label)}` };
  }

  if (jobStatus === "failed") {
    return {
      variant: "failed",
      label: failedLabel(input.lastFinishedJob),
      ...(input.lastFinishedJobId ? { jobId: input.lastFinishedJobId } : {}),
    };
  }

  if (jobStatus === "idle" && latestJob?.status === "failed") {
    return { variant: "failed", label: failedLabel(latestJob), jobId: latestJob.id };
  }
  if (jobStatus === "idle" && latestJob?.status === "running") {
    return { variant: "running", label: "Job running", jobId: latestJob.id };
  }

  const stamp = latestJob?.status === "succeeded" ? (latestJob.finished_at ?? latestJob.started_at) : null;
  return {
    variant: "idle",
    label: stamp ? `Library up to date · ${compactAgo(stamp, input.nowMs)}` : "Library up to date",
  };
}

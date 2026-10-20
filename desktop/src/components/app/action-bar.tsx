import { useNavigate } from "@tanstack/react-router";
import { Check, RefreshCw, Terminal, X } from "lucide-react";
import { toast } from "sonner";

import { StatusPill } from "~/components/app/status-pill";
import { Button, IconButton } from "~/components/ui/button";
import { relativeTime } from "~/domain/jobs";
import { runningJobStatusLabel } from "~/domain/job-labels";
import { VIEWER_WRITE_REASON, viewerBlocksWrite } from "~/domain/library-role";
import { PROVIDER_FALLBACK, signedOutJobMessage } from "~/domain/provider";
import { useNow } from "~/hooks/use-now";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { fetchAuthStatus } from "~/lib/auth-refresh";
import { useEffectiveProvider } from "~/lib/queries/effective-provider";
import { useLibrary } from "~/lib/queries/library";
import {
  useCancelUpdateMutation,
  useJobs,
  usePlanUpdateMutation,
  useStartCitationJobMutation,
} from "~/lib/queries/jobs";
import { useSettings } from "~/lib/queries/settings";
import { modShortcut } from "~/lib/shortcuts";
import { useJobStore } from "~/stores/job-store";
import { useUpdatePlanStore } from "~/stores/update-plan-store";
import { useUiStore } from "~/stores/ui-store";

export function ActionBar({ course }: { course: string }) {
  const navigate = useNavigate();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const library = useLibrary(activeRoot);
  const role = library.data?.present === true ? library.data.role : null;
  const viewerBlocked = viewerBlocksWrite(role);
  const effective = useEffectiveProvider(activeRoot);
  const jobStatus = useJobStore((s) => s.status);
  const jobStep = useJobStore((s) => s.step);
  const jobLabel = useJobStore((s) => s.label);
  const activeUpdateJobId = useJobStore((s) => s.activeUpdateJobId);
  const lastFinishedJobId = useJobStore((s) => s.lastFinishedJobId);
  const unread = useJobStore((s) => s.unread);
  const appendLog = useJobStore((s) => s.append);
  const toggleLog = useUiStore((s) => s.toggleLog);
  const planUpdate = usePlanUpdateMutation(activeRoot);
  const cancelUpdate = useCancelUpdateMutation();
  const startCitations = useStartCitationJobMutation(activeRoot);
  const jobs = useJobs(activeRoot);
  const nowMs = useNow();

  const latestJob = jobs.data?.[0];
  const statusLabel = (() => {
    if (jobStatus === "running") {
      return runningJobStatusLabel(jobStep, jobLabel);
    }
    if (jobStatus === "failed") {
      return "Last job failed";
    }
    if (jobStatus === "idle" && latestJob?.status === "failed") {
      return "Last job failed";
    }
    if (jobStatus === "idle" && latestJob?.status === "running") {
      return "Job running";
    }
    const stamp = latestJob?.finished_at ?? latestJob?.started_at;
    if (latestJob?.status === "succeeded" && stamp) {
      return `Up to date · ${relativeTime(stamp, nowMs)}`;
    }
    return "Up to date";
  })();

  const statusPillVariant = (() => {
    if (jobStatus === "running" || (jobStatus === "idle" && latestJob?.status === "running")) {
      return "running" as const;
    }
    if (
      jobStatus === "failed" ||
      (jobStatus === "idle" && latestJob?.status === "failed")
    ) {
      return "failed" as const;
    }
    return "idle" as const;
  })();

  const jobsLinkId = (() => {
    if (jobStatus === "failed" && lastFinishedJobId) {
      return lastFinishedJobId;
    }
    if (jobStatus === "idle" && latestJob?.status === "failed") {
      return latestJob.id;
    }
    if (jobStatus === "idle" && latestJob?.status === "running") {
      return latestJob.id;
    }
    return undefined;
  })();

  const statusPillAriaLabel = (() => {
    if (statusPillVariant === "running") {
      return `Job status: ${statusLabel}`;
    }
    if (statusPillVariant === "failed") {
      return "Last job failed. Open Jobs.";
    }
    return `Knowledge status: ${statusLabel}. Open Jobs.`;
  })();

  const onStatusPillClick = () => {
    if (jobStatus === "running") {
      return;
    }
    void navigate({
      to: "/jobs",
      search: jobsLinkId ? { job: jobsLinkId } : {},
    });
  };

  const onUpdate = async () => {
    if (!activeRoot || viewerBlocked || !effective.providerId) {
      return;
    }
    const providerId = effective.providerId;
    try {
      const auth = await fetchAuthStatus(providerId, true);
      if (!auth.authenticated) {
        const label =
          PROVIDER_FALLBACK.find((p) => p.id === providerId)?.label ?? providerId;
        appendLog(signedOutJobMessage(label, auth.reason ?? ""));
        return;
      }
      const plan = await planUpdate.mutateAsync();
      if (plan.pending.length === 0) {
        appendLog("Nothing to process — everything is up to date.");
        return;
      }
      useUpdatePlanStore.getState().setPendingPlan(plan.pending, true, "manual");
    } catch (error) {
      toast.error(String(error));
    }
  };

  const onCitations = async () => {
    if (!activeRoot || !course || !effective.modelId || viewerBlocked || !effective.providerId) {
      return;
    }
    try {
      await startCitations.mutateAsync({
        course,
        force: false,
        model: effective.modelId,
        provider: effective.providerId,
      });
    } catch (error) {
      toast.error(String(error));
    }
  };

  const writeDisabled = viewerBlocked || !activeRoot || !course;
  const updateButton = (
    <Button
      variant="default"
      size="sm"
      disabled={writeDisabled}
      onClick={() => void onUpdate()}
    >
      <RefreshCw className="size-icon-sm" />
      Update knowledge
    </Button>
  );

  const citationsButton = (
    <Button variant="ghost" size="sm" disabled={writeDisabled} onClick={() => void onCitations()}>
      <Check className="size-icon-sm" />
      Check citations
    </Button>
  );

  const pillRunning =
    jobStatus === "running" || (jobStatus === "idle" && latestJob?.status === "running");

  return (
    <div className="flex h-actionbar min-w-0 shrink-0 items-center gap-2 border-b border-dashed border-border px-4">
      <span
        className="inline-flex"
        title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
      >
        {updateButton}
      </span>
      {jobStatus === "running" && activeUpdateJobId ? (
        <Button variant="outline" size="sm" onClick={() => void cancelUpdate.mutateAsync()}>
          <X className="size-icon-sm" />
          Cancel
        </Button>
      ) : null}
      <span
        className="inline-flex"
        title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
      >
        {citationsButton}
      </span>
      {viewerBlocked ? (
        <span className="text-2xs text-muted-foreground" data-testid="viewer-write-hint">
          Viewer role — write jobs disabled
        </span>
      ) : null}
      <span className="flex-1" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto min-w-0 px-0 hover:bg-transparent"
        disabled={pillRunning}
        onClick={onStatusPillClick}
        data-testid="status-pill-button"
        aria-label={statusPillAriaLabel}
      >
        <StatusPill variant={statusPillVariant} label={statusLabel} />
      </Button>
      <div className="relative">
        <IconButton
          icon={Terminal}
          label={`Toggle log (${modShortcut("`")})`}
          size="icon-sm"
          variant="ghost"
          onClick={toggleLog}
        />
        {unread > 0 ? (
          <span
            className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-primary ring-2 ring-background"
            data-testid="log-unread-dot"
            aria-hidden
          />
        ) : null}
      </div>
    </div>
  );
}

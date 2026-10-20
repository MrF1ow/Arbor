import { useNavigate } from "@tanstack/react-router";
import { Check, RefreshCw, Terminal, X } from "lucide-react";
import { toast } from "sonner";

import { StatusPill } from "~/components/app/status-pill";
import { Button, IconButton } from "~/components/ui/button";
import { relativeTime } from "~/domain/jobs";
import { runningJobStatusLabel } from "~/domain/job-labels";
import { VIEWER_WRITE_REASON, viewerBlocksWrite } from "~/domain/library-role";
import { PROVIDER_FALLBACK, signedOutJobMessage } from "~/domain/provider";
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
  const unread = useJobStore((s) => s.unread);
  const appendLog = useJobStore((s) => s.append);
  const toggleLog = useUiStore((s) => s.toggleLog);
  const planUpdate = usePlanUpdateMutation(activeRoot);
  const cancelUpdate = useCancelUpdateMutation();
  const startCitations = useStartCitationJobMutation(activeRoot);
  const jobs = useJobs(activeRoot);

  const latestJob = jobs.data?.[0];
  const statusLabel = (() => {
    if (jobStatus === "running") {
      return runningJobStatusLabel(jobStep, jobLabel);
    }
    if (jobStatus === "failed") {
      return "Last job failed";
    }
    const stamp = latestJob?.finished_at ?? latestJob?.started_at;
    if (latestJob?.status === "succeeded" && stamp) {
      return `Up to date · ${relativeTime(stamp, jobs.dataUpdatedAt)}`;
    }
    return "Up to date";
  })();

  const onStatusPillClick = () => {
    if (jobStatus === "running") {
      return;
    }
    const failedJob =
      jobStatus === "failed"
        ? (jobs.data?.find((j) => j.status === "failed") ?? latestJob)
        : undefined;
    const failedId = failedJob?.id;
    void navigate({
      to: "/jobs",
      search: failedId ? { job: failedId } : {},
    });
  };

  const onUpdate = async () => {
    if (!activeRoot || viewerBlocked) {
      return;
    }
    try {
      const auth = await fetchAuthStatus(effective.providerId, true);
      if (!auth.authenticated) {
        const label =
          PROVIDER_FALLBACK.find((p) => p.id === effective.providerId)?.label ??
          effective.providerId;
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
    if (!activeRoot || !course || !effective.modelId || viewerBlocked) {
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
        disabled={jobStatus === "running"}
        onClick={onStatusPillClick}
        data-testid="status-pill-button"
      >
        <StatusPill
          variant={jobStatus === "running" ? "running" : jobStatus === "failed" ? "failed" : "idle"}
          label={statusLabel}
        />
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

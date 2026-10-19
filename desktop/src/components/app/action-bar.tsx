import { Check, RefreshCw, Terminal, X } from "lucide-react";
import { toast } from "sonner";

import { StatusPill } from "~/components/app/status-pill";
import { Button, IconButton } from "~/components/ui/button";
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

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function ActionBar({ course }: { course: string }) {
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const library = useLibrary(activeRoot);
  const role = library.data?.present === true ? library.data.role : null;
  const viewerBlocked = viewerBlocksWrite(role);
  const effective = useEffectiveProvider(activeRoot);
  const jobStatus = useJobStore((s) => s.status);
  const jobStep = useJobStore((s) => s.step);
  const activeUpdateJobId = useJobStore((s) => s.activeUpdateJobId);
  const unread = useJobStore((s) => s.unread);
  const appendLog = useJobStore((s) => s.append);
  const toggleLog = useUiStore((s) => s.toggleLog);
  const planUpdate = usePlanUpdateMutation(activeRoot);
  const cancelUpdate = useCancelUpdateMutation();
  const startCitations = useStartCitationJobMutation(activeRoot);
  const jobs = useJobs(activeRoot);

  const lastOk = jobs.data?.find((j) => j.status === "succeeded");
  const statusLabel = (() => {
    if (jobStatus === "running") {
      return jobStep ?? "Running…";
    }
    if (jobStatus === "failed") {
      return "Last job failed";
    }
    if (lastOk?.finished_at) {
      return `Up to date · ${formatRelativeTime(lastOk.finished_at)}`;
    }
    return "Up to date";
  })();

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
      <StatusPill
        variant={jobStatus === "running" ? "running" : jobStatus === "failed" ? "failed" : "idle"}
        label={statusLabel}
      />
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

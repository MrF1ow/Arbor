import { useRouterState } from "@tanstack/react-router";
import { Check, RefreshCw, Terminal, X } from "lucide-react";

import { StatusPill } from "~/components/app/status-pill";
import { Button, IconButton } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { VIEWER_WRITE_REASON, viewerBlocksWrite } from "~/domain/library-role";
import { pickActiveRoot } from "~/lib/knowledge-root";
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

export function ActionBar() {
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const library = useLibrary(activeRoot);
  const role = library.data?.present === true ? library.data.role : null;
  const viewerBlocked = viewerBlocksWrite(role);
  const effective = useEffectiveProvider(activeRoot);
  const jobStatus = useJobStore((s) => s.status);
  const jobStep = useJobStore((s) => s.step);
  const unread = useJobStore((s) => s.unread);
  const toggleLog = useUiStore((s) => s.toggleLog);
  const planUpdate = usePlanUpdateMutation(activeRoot);
  const cancelUpdate = useCancelUpdateMutation();
  const startCitations = useStartCitationJobMutation(activeRoot);
  const jobs = useJobs(activeRoot);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const course = pathname.match(/\/course\/([^/]+)/)?.[1] ?? null;

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
    const plan = await planUpdate.mutateAsync();
    if (plan.pending.length > 0) {
      useUpdatePlanStore.getState().setPendingPlan(plan.pending, true);
    }
  };

  const onCitations = async () => {
    if (!activeRoot || !course || !effective.modelId || viewerBlocked) {
      return;
    }
    await startCitations.mutateAsync({
      course,
      force: false,
      model: effective.modelId,
      provider: effective.providerId,
    });
  };

  const writeDisabled = viewerBlocked || !activeRoot || !course;

  return (
    <div className="flex h-actionbar shrink-0 items-center gap-2 border-b border-dashed border-border px-4">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="default"
              size="sm"
              disabled={writeDisabled}
              onClick={() => void onUpdate()}
            >
              <RefreshCw className="size-icon-sm" />
              Update knowledge
            </Button>
          }
        />
        {viewerBlocked ? <TooltipContent>{VIEWER_WRITE_REASON}</TooltipContent> : null}
      </Tooltip>
      {jobStatus === "running" ? (
        <Button variant="outline" size="sm" onClick={() => void cancelUpdate.mutateAsync()}>
          <X className="size-icon-sm" />
          Cancel
        </Button>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="sm" disabled={writeDisabled} onClick={() => void onCitations()}>
              <Check className="size-icon-sm" />
              Check citations
            </Button>
          }
        />
        {viewerBlocked ? <TooltipContent>{VIEWER_WRITE_REASON}</TooltipContent> : null}
      </Tooltip>
      {viewerBlocked ? (
        <span className="text-2xs text-muted-foreground">Viewer role — write jobs disabled</span>
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
            aria-hidden
          />
        ) : null}
      </div>
    </div>
  );
}

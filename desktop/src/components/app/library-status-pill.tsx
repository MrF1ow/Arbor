import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

import { libraryStatus, type LibraryStatusVariant } from "~/components/app/library-status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { courseDisplayName, workspaceRootLabel } from "~/domain/course";
import { VIEWER_WRITE_REASON, viewerBlocksWrite } from "~/domain/library-role";
import { PROVIDER_FALLBACK, providerBadge, signedOutJobMessage } from "~/domain/provider";
import { canUseDesktopIpc } from "~/domain/tauri";
import { remainingPercent, type UsageLimits } from "~/domain/usage";
import { useNow } from "~/hooks/use-now";
import { fetchAuthStatus } from "~/lib/auth-refresh";
import { classSearchFrom } from "~/lib/class-path";
import { invoke } from "~/lib/ipc";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useChooseKnowledgeFolder } from "~/lib/hooks/use-choose-knowledge-folder";
import { usePendingActiveRootSwitch } from "~/lib/queries/active-root";
import { useAuth } from "~/lib/queries/auth";
import { useEffectiveProvider } from "~/lib/queries/effective-provider";
import {
  useCancelUpdateMutation,
  useJobs,
  usePlanUpdateMutation,
  useStartCitationJobMutation,
} from "~/lib/queries/jobs";
import { qk } from "~/lib/queries/keys";
import { useCourses, useLibrary } from "~/lib/queries/library";
import { useProviderUsage } from "~/lib/queries/provider-usage";
import { useSettings } from "~/lib/queries/settings";
import { isMacPlatform, modKeyLabel, modShortcut } from "~/lib/shortcuts";
import { cn } from "~/lib/utils";
import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";
import { useUpdatePlanStore } from "~/stores/update-plan-store";
import type { UpdatePlan } from "~/domain/types";

const DOT: Record<LibraryStatusVariant, string> = {
  idle: "bg-primary",
  running: "bg-info",
  failed: "bg-destructive",
  none: "bg-faint-foreground",
};

const ITEM =
  "min-h-0 gap-2 rounded-md px-2 py-1.5 text-small focus:bg-selected focus:text-foreground data-highlighted:bg-selected data-highlighted:text-foreground";
const HINT = "ml-auto text-caption text-muted-foreground";

/**
 * The class the menu's Check citations runs on: the open one, else the last one used, else the
 * first. `inClass` is false when the choice was not the open class, so the menu names it.
 */
function useMenuCourse(root: string | null): { course: string | null; inClass: boolean } {
  const params = useParams({ strict: false });
  const courses = useCourses(root);
  const lastCourse = useUiStore((s) => s.lastCourse);
  const list = courses.data ?? [];
  if (typeof params.course === "string" && list.includes(params.course)) {
    return { course: params.course, inClass: true };
  }
  if (lastCourse && lastCourse.root === root && list.includes(lastCourse.course)) {
    return { course: lastCourse.course, inClass: false };
  }
  return { course: list[0] ?? null, inClass: false };
}

/**
 * True while the class page in the URL is waiting for its library: a library switch is queued or
 * running, or the location's `?root=` names a configured library other than the active one. The
 * URL's class is then not the active library's class even when that library has one of the same
 * name, so nothing class-scoped may start from the menu: it would write to the wrong library.
 */
function useClassPageWaitsForLibrary(activeRoot: string | null, roots: { path: string }[]): boolean {
  const pending = usePendingActiveRootSwitch();
  const urlRoot = useRouterState({
    select: (s) => (s.location.pathname.startsWith("/course/") ? classSearchFrom(s.location.search).root : undefined),
  });
  const mismatch = urlRoot !== undefined && roots.some((entry) => entry.path === urlRoot) && urlRoot !== activeRoot;
  return pending !== null || mismatch;
}

/** The log shortcut as the menu hints it: Command-backtick on a Mac, "Ctrl+`" elsewhere. */
function logShortcutLabel(): string {
  return isMacPlatform() ? `${modKeyLabel()}\`` : modShortcut("`");
}

/** "Codex · signed in · 64% of weekly limit left": the menu's last row. */
function useProviderLine(root: string | null): string {
  const effective = useEffectiveProvider(root);
  const auth = useAuth(effective.providerId);
  const usage = useProviderUsage(effective.providerId, { enabled: auth.data?.authenticated === true });
  if (!canUseDesktopIpc()) {
    return "Desktop app required";
  }
  if (!effective.ready || !effective.providerId) {
    return "Checking provider…";
  }
  const label =
    PROVIDER_FALLBACK.find((p) => p.id === effective.providerId)?.label ?? effective.providerId;
  if (auth.isLoading) {
    return `${label} · checking…`;
  }
  if (!auth.data?.authenticated) {
    return providerBadge(label, effective.modelId ?? "no model", false, auth.data?.reason);
  }
  const window = weeklyWindow(usage.data);
  return window
    ? `${label} · signed in · ${remainingPercent(window)}% of ${window.label.toLowerCase()} limit left`
    : `${label} · signed in`;
}

function weeklyWindow(usage: UsageLimits | undefined) {
  return usage?.windows.find((w) => w.kind === "weekly") ?? usage?.windows[0];
}

/**
 * The top bar's library status pill and the menu it opens (Update knowledge, Check citations,
 * Show log, All jobs, provider line). It replaces the old action bar. With no Knowledge folder
 * the pill is a plain button that chooses one.
 */
export function LibraryStatusPill() {
  const navigate = useNavigate();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const roots = settings.data?.knowledge_roots ?? [];
  const library = useLibrary(activeRoot);
  const role = library.data?.present === true ? library.data.role : null;
  const viewerBlocked = viewerBlocksWrite(role);
  const effective = useEffectiveProvider(activeRoot);
  const { course: menuCourse, inClass } = useMenuCourse(activeRoot);
  // No class to run on while the class page waits for its library (see the hook).
  const waitingForLibrary = useClassPageWaitsForLibrary(activeRoot, roots);
  const course = waitingForLibrary ? null : menuCourse;
  const providerLine = useProviderLine(activeRoot);
  const { chooseFolder, desktopIpc } = useChooseKnowledgeFolder();
  const [open, setOpen] = useState(false);
  const nowMs = useNow();

  const jobStatus = useJobStore((s) => s.status);
  const step = useJobStore((s) => s.step);
  const label = useJobStore((s) => s.label);
  const progress = useJobStore((s) => s.progress);
  const jobRoot = useJobStore((s) => s.root);
  const activeUpdateJobId = useJobStore((s) => s.activeUpdateJobId);
  const lastFinishedJobId = useJobStore((s) => s.lastFinishedJobId);
  const unread = useJobStore((s) => s.unread);
  const appendLog = useJobStore((s) => s.append);
  const toggleLog = useUiStore((s) => s.toggleLog);

  const jobs = useJobs(activeRoot);
  const planUpdate = usePlanUpdateMutation(activeRoot);
  const cancelUpdate = useCancelUpdateMutation();
  const startCitations = useStartCitationJobMutation(activeRoot);
  const pendingFiles = useQuery({
    queryKey: qk.planUpdate(activeRoot ?? ""),
    enabled: open && Boolean(activeRoot) && !viewerBlocked,
    // Files can land between two opens, so the count is fresh each time the menu opens.
    staleTime: 0,
    queryFn: () => invoke<UpdatePlan>("plan_update", { root: activeRoot! }),
  });

  const jobEntry = jobRoot && jobRoot !== activeRoot ? roots.find((r) => r.path === jobRoot) : undefined;
  const latest = jobs.data?.[0] ?? null;
  const lastFinished = lastFinishedJobId ? (jobs.data?.find((j) => j.id === lastFinishedJobId) ?? null) : null;
  // The store forgets which library a finished job ran in, but the active library's job list
  // knows its own: a finished job that list (once fresh) lacks was run by another library.
  const finishedElsewhere =
    lastFinishedJobId !== null &&
    jobs.isSuccess &&
    !jobs.isFetching &&
    !jobs.data.some((j) => j.id === lastFinishedJobId);
  const status = libraryStatus({
    desktop: desktopIpc,
    hasRoot: Boolean(activeRoot),
    jobStatus,
    step,
    label,
    progress,
    jobLibrary: jobEntry ? workspaceRootLabel(jobEntry, roots) : null,
    lastFinishedJobId,
    finishedElsewhere,
    lastFinishedJob: lastFinished ? { skill: lastFinished.skill } : null,
    latestJob: latest
      ? {
          id: latest.id,
          status: latest.status,
          started_at: latest.started_at,
          finished_at: latest.finished_at,
          skill: latest.skill,
        }
      : null,
    nowMs,
  });

  const onUpdate = async () => {
    if (!activeRoot || viewerBlocked || !effective.providerId) {
      return;
    }
    const providerId = effective.providerId;
    try {
      const auth = await fetchAuthStatus(providerId, true);
      if (!auth.authenticated) {
        const name = PROVIDER_FALLBACK.find((p) => p.id === providerId)?.label ?? providerId;
        appendLog(signedOutJobMessage(name, auth.reason ?? ""));
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

  const pillClass = cn(
    "relative inline-flex h-6.75 max-w-44 min-w-24 shrink md:max-w-80 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-caption text-muted-foreground outline-none transition-colors duration-fast ease-out-soft hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
  );
  const pillBody = (
    <>
      <span aria-hidden className={cn("size-1.75 shrink-0 rounded-full", DOT[status.variant])} />
      <span className="min-w-0 truncate">{status.label}</span>
      {status.variant !== "none" ? (
        <ChevronDown aria-hidden className="size-icon-sm shrink-0 text-faint-foreground" />
      ) : null}
      {unread > 0 ? (
        <span
          className="pointer-events-none absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-background"
          data-testid="log-unread-dot"
          aria-hidden
        />
      ) : null}
    </>
  );

  if (settings.isLoading) {
    // Until get_settings answers there is no way to know whether a library is set, so the pill
    // must not claim "No Knowledge folder" or act as the choose-folder button.
    return (
      <button
        type="button"
        data-testid="library-status-pill"
        className={pillClass}
        disabled
        aria-busy="true"
      >
        <span aria-hidden className={cn("size-1.75 shrink-0 rounded-full", DOT.none)} />
        <span className="min-w-0 truncate">Loading library…</span>
      </button>
    );
  }

  if (!activeRoot) {
    return (
      <button
        type="button"
        data-testid="library-status-pill"
        className={pillClass}
        disabled={!desktopIpc}
        title="Choose Knowledge folder"
        onClick={() => void chooseFolder()}
      >
        {pillBody}
      </button>
    );
  }

  const pending = pendingFiles.data?.pending.length ?? null;
  const writeDisabled = viewerBlocked || !activeRoot;
  const canCancel = jobStatus === "running" && Boolean(activeUpdateJobId);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        data-testid="library-status-pill"
        aria-label={`Library status: ${status.label}`}
        className={pillClass}
      >
        {pillBody}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={6} className="w-77.5 rounded-xl p-1.5 shadow-popover">
        <DropdownMenuItem
          className={ITEM}
          disabled={writeDisabled}
          title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
          onClick={() => void onUpdate()}
        >
          Update knowledge
          {pending ? <span className={HINT}>{pending === 1 ? "1 new file" : `${pending} new files`}</span> : null}
        </DropdownMenuItem>
        {canCancel ? (
          <DropdownMenuItem className={ITEM} onClick={() => void cancelUpdate.mutateAsync()}>
            Cancel update
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          className={ITEM}
          disabled={writeDisabled || !course}
          title={viewerBlocked ? VIEWER_WRITE_REASON : waitingForLibrary ? "Switching library…" : undefined}
          onClick={() => void onCitations()}
        >
          Check citations
          {course && !inClass ? ` · ${courseDisplayName(course)}` : null}
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} onClick={toggleLog}>
          Show log
          <span className={HINT}>{logShortcutLabel()}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={ITEM}
          onClick={() =>
            void navigate({
              to: "/jobs",
              search: status.jobId ? { job: status.jobId } : {},
            })
          }
        >
          All jobs
        </DropdownMenuItem>
        {viewerBlocked ? (
          <p className="px-2 py-1 text-micro text-muted-foreground" data-testid="viewer-write-hint">
            Viewer role — write jobs disabled
          </p>
        ) : null}
        <DropdownMenuSeparator className="mx-0 my-1" />
        <DropdownMenuItem
          className={cn(ITEM, "text-caption text-muted-foreground")}
          data-testid="library-menu-provider"
          onClick={() => void navigate({ to: "/settings/provider" })}
        >
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
          <span className="min-w-0 truncate">{providerLine}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

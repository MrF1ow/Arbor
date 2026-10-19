import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  PanelLeft,
  Plus,
  Settings2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ListRow } from "~/components/app/list-row";
import { SectionLabel } from "~/components/app/section-label";
import { Button, IconButton } from "~/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import { Input } from "~/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "~/components/ui/sidebar";
import { courseDisplayName, workspaceRootLabel } from "~/domain/course";
import type { KnowledgeRootEntry } from "~/domain/types";
import { PROVIDER_FALLBACK, isWorkerUnavailableAuthReason, providerBadge } from "~/domain/provider";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { openDialog } from "~/lib/ipc";
import { useActivateKnowledgeRootMutation, useSwitchActiveRootMutation } from "~/lib/queries/active-root";
import { useAuth } from "~/lib/queries/auth";
import { useCreateCourseMutation, useCourses, useDigests } from "~/lib/queries/library";
import { useEffectiveProvider } from "~/lib/queries/effective-provider";
import { useSettings } from "~/lib/queries/settings";
import { modShortcut } from "~/lib/shortcuts";
import { cn } from "~/lib/utils";
import { useUiStore } from "~/stores/ui-store";
import markLight from "~/assets/arbor-mark.png";
import markDark from "~/assets/arbor-mark-dark.png";

function CourseNavRow({
  root,
  course,
  activeRoot,
  activeCourse,
  digestCount,
  onSelect,
}: {
  root: string;
  course: string;
  activeRoot: string | null;
  activeCourse: string | null;
  digestCount?: number;
  onSelect: (root: string, course: string) => void;
}) {
  const active = activeRoot === root && activeCourse === course;
  return (
    <ListRow
      title={courseDisplayName(course)}
      meta={digestCount != null ? String(digestCount) : undefined}
      icon={BookOpen}
      active={active}
      onSelect={() => onSelect(root, course)}
      className="pl-4"
    />
  );
}

function ProviderStatusLine({ root }: { root: string | null }) {
  const effective = useEffectiveProvider(root);
  const auth = useAuth(effective.providerId);
  const providerLabel =
    PROVIDER_FALLBACK.find((p) => p.id === effective.providerId)?.label ?? effective.providerId;
  const modelLabel = effective.modelId ?? "no model";

  let text: string;
  let dotClass = "bg-primary";
  if (auth.isLoading) {
    text = `${providerLabel} · checking…`;
    dotClass = "bg-muted-foreground";
  } else if (auth.data?.authenticated) {
    text = `${providerLabel} · ${modelLabel}`;
  } else {
    text = providerBadge(providerLabel, modelLabel, false, auth.data?.reason);
    if (auth.data?.reason && isWorkerUnavailableAuthReason(auth.data.reason)) {
      dotClass = "bg-destructive";
    } else {
      dotClass = "bg-muted-foreground";
    }
  }

  return (
    <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
      <span className={cn("size-1.5 shrink-0 rounded-full", dotClass)} aria-hidden />
      <span className="truncate">{text}</span>
    </div>
  );
}

export function AppSidebar() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const params = useParams({ strict: false });
  const activeCourse = typeof params.course === "string" ? params.course : null;
  const { setOpen, isMobile } = useSidebar();
  const markSidebarTouched = useUiStore((s) => s.markSidebarTouched);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const roots = settings.data?.knowledge_roots ?? [];
  const switchRoot = useSwitchActiveRootMutation();
  const activateRoot = useActivateKnowledgeRootMutation();
  const createCourse = useCreateCourseMutation(activeRoot);
  const activeDigests = useDigests(activeRoot, activeCourse ?? "");
  const [addingClass, setAddingClass] = useState(false);
  const [className, setClassName] = useState("");
  const [classError, setClassError] = useState<string | null>(null);

  const onCourseSelect = async (root: string, course: string) => {
    try {
      if (root !== activeRoot) {
        await switchRoot.mutateAsync(root);
      }
      void navigate({ to: "/course/$course/notes", params: { course } });
      if (isMobile) {
        setOpen(false);
      }
    } catch (error) {
      toast.error(String(error));
    }
  };

  const onPickFolder = async () => {
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked !== "string") {
        return;
      }
      await activateRoot.mutateAsync(picked);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const onCreateClass = async () => {
    const name = className.trim();
    if (!name) {
      setClassError("Enter a class name.");
      return;
    }
    if (!activeRoot) {
      setClassError("Choose a Knowledge folder first.");
      return;
    }
    try {
      const slug = await createCourse.mutateAsync(name);
      setClassName("");
      setClassError(null);
      setAddingClass(false);
      void navigate({ to: "/course/$course/notes", params: { course: slug } });
    } catch (error) {
      setClassError(String(error));
    }
  };

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="flex h-header flex-row items-center justify-between border-b border-sidebar-border px-3">
        <div className="flex items-center gap-2.5">
          <img src={markLight} alt="" className="size-7 dark:hidden" />
          <img src={markDark} alt="" className="hidden size-7 dark:block" />
          <span className="font-serif text-lg font-medium">Arbor</span>
        </div>
        <IconButton
          icon={PanelLeft}
          label={`Hide sidebar (${modShortcut("B")})`}
          size="icon-sm"
          variant="ghost"
          tooltip={false}
          onClick={() => {
            markSidebarTouched();
            setSidebarOpen(false);
            setOpen(false);
          }}
        />
      </SidebarHeader>
      <SidebarContent className="gap-1 px-2 py-1">
        <SectionLabel
          className="px-1 pt-2"
          action={
            <IconButton
              icon={Plus}
              label="Add class"
              size="icon-xs"
              variant="ghost"
              tooltip={false}
              onClick={() => setAddingClass((v) => !v)}
            />
          }
        >
          Library
        </SectionLabel>
        {addingClass ? (
          <div className="space-y-1 px-1 pb-2">
            <Input
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              placeholder="Class name"
              aria-label="Class name"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void onCreateClass();
                }
              }}
            />
            {classError ? <p className="text-2xs text-destructive">{classError}</p> : null}
            <Button size="sm" className="w-full" onClick={() => void onCreateClass()}>
              Create class
            </Button>
          </div>
        ) : null}
        {roots.map((entry) => (
          <RootGroup
            key={entry.path}
            entry={entry}
            all={roots}
            activeRoot={activeRoot}
            activeCourse={activeCourse}
            activeDigestCount={
              entry.path === activeRoot && activeCourse ? activeDigests.data?.length : undefined
            }
            onCourseSelect={onCourseSelect}
            onRootSelect={(root) => void switchRoot.mutateAsync(root).catch((e) => toast.error(String(e)))}
          />
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <ListRow
              title="Jobs"
              icon={Activity}
              active={pathname.startsWith("/jobs")}
              onSelect={() => void navigate({ to: "/jobs" })}
            />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <ListRow
              title="Settings"
              icon={Settings2}
              active={pathname.startsWith("/settings")}
              onSelect={() => void navigate({ to: "/settings" })}
            />
          </SidebarMenuItem>
        </SidebarMenu>
        <ProviderStatusLine root={activeRoot} />
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => void onPickFolder()}>
          <FolderOpen className="size-icon-sm" />
          Choose Knowledge folder…
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}

function RootGroup({
  entry,
  all,
  activeRoot,
  activeCourse,
  activeDigestCount,
  onCourseSelect,
  onRootSelect,
}: {
  entry: KnowledgeRootEntry;
  all: KnowledgeRootEntry[];
  activeRoot: string | null;
  activeCourse: string | null;
  activeDigestCount?: number;
  onCourseSelect: (root: string, course: string) => void;
  onRootSelect: (root: string) => void;
}) {
  const courses = useCourses(entry.path);
  const label = `${workspaceRootLabel(entry, all)} · ${entry.kind}`;
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex w-full items-center gap-0.5">
        <CollapsibleTrigger className="flex shrink-0 items-center rounded-sm p-1 text-muted-foreground hover:bg-muted">
          {open ? <ChevronDown className="size-icon-sm" /> : <ChevronRight className="size-icon-sm" />}
        </CollapsibleTrigger>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto min-w-0 flex-1 justify-start px-1 py-1 text-left text-xs font-medium text-muted-foreground"
          onClick={() => onRootSelect(entry.path)}
        >
          <span className="truncate">{label}</span>
        </Button>
      </div>
      <CollapsibleContent className="pb-1">
        {(courses.data ?? []).length === 0 ? (
          <p className="px-4 py-1 text-2xs text-muted-foreground">No classes yet</p>
        ) : (
          (courses.data ?? []).map((course) => (
            <CourseNavRow
              key={course}
              root={entry.path}
              course={course}
              activeRoot={activeRoot}
              activeCourse={activeCourse}
              digestCount={
                entry.path === activeRoot && course === activeCourse ? activeDigestCount : undefined
              }
              onSelect={onCourseSelect}
            />
          ))
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

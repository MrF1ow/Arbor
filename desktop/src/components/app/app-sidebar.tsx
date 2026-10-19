import { useNavigate, useRouterState } from "@tanstack/react-router";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
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
import markLight from "~/assets/arbor-mark.png";
import markDark from "~/assets/arbor-mark-dark.png";

function CourseNavRow({
  root,
  course,
  activeRoot,
  activeCourse,
  onSelect,
}: {
  root: string;
  course: string;
  activeRoot: string | null;
  activeCourse: string | null;
  onSelect: (root: string, course: string) => void;
}) {
  const digests = useDigests(root, course);
  const count = digests.data?.length;
  const active = activeRoot === root && activeCourse === course;
  return (
    <ListRow
      title={courseDisplayName(course)}
      meta={count != null ? String(count) : undefined}
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
  const { setOpen } = useSidebar();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const roots = settings.data?.knowledge_roots ?? [];
  const switchRoot = useSwitchActiveRootMutation();
  const activateRoot = useActivateKnowledgeRootMutation();
  const createCourse = useCreateCourseMutation(activeRoot);
  const [addingClass, setAddingClass] = useState(false);
  const [className, setClassName] = useState("");
  const [classError, setClassError] = useState<string | null>(null);

  const activeCourse = pathname.match(/\/course\/([^/]+)/)?.[1] ?? null;

  const onCourseSelect = async (root: string, course: string) => {
    if (root !== activeRoot) {
      await switchRoot.mutateAsync(root);
    }
    void navigate({ to: "/course/$course/notes", params: { course } });
    setOpen(false);
  };

  const onPickFolder = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked !== "string") {
      return;
    }
    await activateRoot.mutateAsync(picked);
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
        <Tooltip>
          <TooltipTrigger
            render={
              <IconButton
                icon={PanelLeft}
                label={`Hide sidebar (${modShortcut("B")})`}
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                }}
              />
            }
          />
          <TooltipContent>Hide sidebar ({modShortcut("B")})</TooltipContent>
        </Tooltip>
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
            onCourseSelect={onCourseSelect}
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
  onCourseSelect,
}: {
  entry: KnowledgeRootEntry;
  all: KnowledgeRootEntry[];
  activeRoot: string | null;
  activeCourse: string | null;
  onCourseSelect: (root: string, course: string) => void;
}) {
  const courses = useCourses(entry.path);
  const label = `${workspaceRootLabel(entry, all)} · ${entry.kind}`;
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-sm px-2 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-muted">
        {open ? <ChevronDown className="size-icon-sm" /> : <ChevronRight className="size-icon-sm" />}
        <span className="truncate">{label}</span>
      </CollapsibleTrigger>
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
              onSelect={onCourseSelect}
            />
          ))
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

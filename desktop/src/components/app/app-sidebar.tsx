import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Settings2,
} from "lucide-react";
import { Suspense, lazy, useState } from "react";
import { toast } from "sonner";

import { CourseIconDisplay } from "~/components/app/course-icon-display";

const CourseIconPicker = lazy(() =>
  import("~/components/app/course-icon-picker").then((m) => ({ default: m.CourseIconPicker })),
);
import { ListRow } from "~/components/app/list-row";
import { SectionLabel } from "~/components/app/section-label";
import { Badge } from "~/components/ui/badge";
import { Button, IconButton } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
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
import type { CourseMetaMap } from "~/domain/course-icons";
import { VIEWER_WRITE_REASON, viewerBlocksWrite, type LibraryRole } from "~/domain/library-role";
import type { KnowledgeRootEntry } from "~/domain/types";
import { PROVIDER_FALLBACK, isWorkerUnavailableAuthReason, providerBadge } from "~/domain/provider";
import { canUseDesktopIpc } from "~/domain/tauri";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useChooseKnowledgeFolder } from "~/lib/hooks/use-choose-knowledge-folder";
import { useSwitchActiveRootMutation } from "~/lib/queries/active-root";
import { useAuth } from "~/lib/queries/auth";
import { useCourseMeta } from "~/lib/queries/course-meta";
import { useCreateCourseMutation, useCourses, useDigests, useLibrary } from "~/lib/queries/library";
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
  meta,
  role,
  iconChangeDisabled,
  activeRoot,
  activeCourse,
  digestCount,
  onSelect,
}: {
  root: string;
  course: string;
  meta: CourseMetaMap | undefined;
  role: LibraryRole | null;
  iconChangeDisabled: boolean;
  activeRoot: string | null;
  activeCourse: string | null;
  digestCount?: number;
  onSelect: (root: string, course: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const viewerBlocked = viewerBlocksWrite(role);
  const active = activeRoot === root && activeCourse === course;
  return (
    <div className="group relative flex w-full items-center">
      <ListRow
        title={courseDisplayName(course)}
        meta={digestCount != null ? String(digestCount) : undefined}
        iconNode={<CourseIconDisplay meta={meta} course={course} />}
        active={active}
        onSelect={() => onSelect(root, course)}
        className="w-full pl-4 pr-8"
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton
              icon={MoreHorizontal}
              label="Course actions"
              size="icon-xs"
              variant="ghost"
              className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
            />
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={viewerBlocked || iconChangeDisabled}
            title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
            onClick={() => setPickerOpen(true)}
          >
            Change icon…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Suspense fallback={null}>
        <CourseIconPicker
          root={root}
          course={course}
          meta={meta}
          role={role}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          trigger={
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 size-icon-sm -translate-y-1/2 opacity-0"
            />
          }
        />
      </Suspense>
    </div>
  );
}

function ProviderStatusLine({ root }: { root: string | null }) {
  const effective = useEffectiveProvider(root);
  const auth = useAuth(effective.providerId);
  if (!canUseDesktopIpc()) {
    return (
      <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
        <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
        <span className="truncate">Desktop app required</span>
      </div>
    );
  }
  const providerLabel =
    PROVIDER_FALLBACK.find((p) => p.id === effective.providerId)?.label ??
    effective.providerId ??
    "";
  const modelLabel = effective.modelId ?? "no model";

  let text: string;
  let dotClass = "bg-primary";
  if (!effective.ready || !effective.providerId) {
    text = "Checking provider…";
    dotClass = "bg-muted-foreground";
  } else if (auth.isLoading) {
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
  const { chooseFolder, desktopIpc: sidebarDesktopIpc } = useChooseKnowledgeFolder();
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
          onClick={() => {
            if (isMobile) {
              setOpen(false);
              return;
            }
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
              onSelect={() => void navigate({ to: "/settings/general" })}
            />
          </SidebarMenuItem>
        </SidebarMenu>
        <ProviderStatusLine root={activeRoot} />
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          disabled={!sidebarDesktopIpc}
          onClick={() => void chooseFolder()}
        >
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
  const rootCourseMeta = useCourseMeta(entry.path);
  const library = useLibrary(entry.path);
  const role = library.data?.present === true ? library.data.role : null;
  const iconChangeDisabled = library.isPending;
  const metaForRoot = rootCourseMeta.data;
  const label = workspaceRootLabel(entry, all);
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
          className="h-control min-w-0 flex-1 justify-start gap-1.5 px-1 py-0 text-left text-xs font-medium text-muted-foreground"
          onClick={() => onRootSelect(entry.path)}
        >
          <span className="truncate">{label}</span>
          {entry.kind === "shared" ? (
            <Badge
              variant="outline"
              className="h-6 shrink-0 px-1 py-0 text-2xs font-normal text-faint-foreground"
            >
              shared
            </Badge>
          ) : null}
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
              meta={metaForRoot}
              role={role}
              iconChangeDisabled={iconChangeDisabled}
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

import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { Palette } from "lucide-react";
import { Suspense, lazy, useState } from "react";
import { toast } from "sonner";

import { CourseSwatch } from "~/components/app/course-swatch";
import { NavRow } from "~/components/app/nav-row";
import { Button, IconButton } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Sidebar, SidebarContent, useSidebar } from "~/components/ui/sidebar";
import { SettingsNav } from "~/components/settings/settings-nav";
import { courseDisplayName, workspaceRootLabel } from "~/domain/course";
import type { CourseMetaMap } from "~/domain/course-icons";
import { VIEWER_WRITE_REASON, viewerBlocksWrite, type LibraryRole } from "~/domain/library-role";
import type { KnowledgeRootEntry } from "~/domain/types";
import { classPath } from "~/lib/class-path";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { usePendingActiveRootSwitch, useSwitchActiveRootMutation } from "~/lib/queries/active-root";
import { useCourseMeta } from "~/lib/queries/course-meta";
import { useCreateCourseMutation, useCourses, useLibrary } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";
import { useTodayAll } from "~/lib/queries/today";
import { cn } from "~/lib/utils";

const CourseIconPicker = lazy(() =>
  import("~/components/app/course-icon-picker").then((m) => ({ default: m.CourseIconPicker })),
);

/** Cards due per class, by `root::course`, and in all, from every library's `study_today`. */
function useDueCounts() {
  const { summary } = useTodayAll();
  const byClass = new Map<string, number>();
  let total = 0;
  for (const row of summary?.courses ?? []) {
    byClass.set(`${row.root}::${row.course}`, row.due_ids.length);
    total += row.due_ids.length;
  }
  return { byClass, total, known: summary !== undefined };
}

function CourseNavRow({
  root,
  course,
  meta,
  role,
  iconChangeDisabled,
  active,
  due,
  onSelect,
}: {
  root: string;
  course: string;
  meta: CourseMetaMap | undefined;
  role: LibraryRole | null;
  iconChangeDisabled: boolean;
  active: boolean;
  due: number;
  onSelect: (root: string, course: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const viewerBlocked = viewerBlocksWrite(role);
  return (
    <NavRow
      label={courseDisplayName(course)}
      count={due > 0 ? String(due) : null}
      leading={<CourseSwatch meta={meta} course={course} />}
      active={active}
      onSelect={() => onSelect(root, course)}
    >
      <IconButton
        icon={Palette}
        label="Change icon"
        size="icon-xs"
        variant="ghost"
        disabled={viewerBlocked || iconChangeDisabled}
        title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
        className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-focus-within/nav-row:opacity-100 group-hover/nav-row:opacity-100"
        onClick={() => setPickerOpen(true)}
      />
      {pickerOpen ? (
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
      ) : null}
    </NavRow>
  );
}

function RootGroup({
  entry,
  all,
  first,
  activeRoot,
  activeCourse,
  dueByClass,
  onCourseSelect,
  onRootSelect,
}: {
  entry: KnowledgeRootEntry;
  all: KnowledgeRootEntry[];
  first: boolean;
  activeRoot: string | null;
  activeCourse: string | null;
  dueByClass: Map<string, number>;
  onCourseSelect: (root: string, course: string) => void;
  onRootSelect: (root: string) => void;
}) {
  const courses = useCourses(entry.path);
  const courseMeta = useCourseMeta(entry.path);
  const library = useLibrary(entry.path);
  const role = library.data?.present === true ? library.data.role : null;
  const label = workspaceRootLabel(entry, all);

  return (
    <div className="flex flex-col gap-0.5">
      <Button
        variant="ghost"
        className={cn(
          "h-6 w-full min-w-0 justify-start gap-1.5 px-2 text-left text-label font-semibold text-faint-foreground hover:bg-transparent",
          !first && "mt-3",
        )}
        onClick={() => onRootSelect(entry.path)}
      >
        <span className="truncate">{label}</span>
        {entry.kind === "shared" ? (
          <span className="shrink-0 rounded-xs bg-muted px-1.5 text-micro font-normal tracking-normal text-muted-foreground">
            shared
          </span>
        ) : null}
      </Button>
      {(courses.data ?? []).length === 0 ? (
        <p className="px-2 py-1 text-micro text-muted-foreground">No classes yet</p>
      ) : (
        (courses.data ?? []).map((course) => (
          <CourseNavRow
            key={course}
            root={entry.path}
            course={course}
            meta={courseMeta.data}
            role={role}
            iconChangeDisabled={library.isPending}
            active={activeRoot === entry.path && activeCourse === course}
            due={dueByClass.get(`${entry.path}::${course}`) ?? 0}
            onSelect={onCourseSelect}
          />
        ))
      )}
    </div>
  );
}

function LibrarySidebar() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const params = useParams({ strict: false });
  const activeCourse = typeof params.course === "string" ? params.course : null;
  const { setOpen, isMobile } = useSidebar();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const roots = settings.data?.knowledge_roots ?? [];
  const switchRoot = useSwitchActiveRootMutation();
  const pendingRoot = usePendingActiveRootSwitch();
  const createCourse = useCreateCourseMutation(activeRoot);
  const due = useDueCounts();
  const [addingClass, setAddingClass] = useState(false);
  const [className, setClassName] = useState("");
  const [classError, setClassError] = useState<string | null>(null);

  const onCourseSelect = async (root: string, course: string) => {
    try {
      if (root !== activeRoot) {
        await switchRoot.mutateAsync(root);
      }
      void navigate({ ...classPath(course, "overview"), search: { root } });
      if (isMobile) {
        setOpen(false);
      }
    } catch (error) {
      toast.error(String(error));
    }
  };

  /**
   * A library group header switches the active library. Every class route only looks in the active
   * library, so a class open in the old one would turn into "Class not found": land on Today instead.
   */
  const onLibrarySelect = async (root: string) => {
    // Nothing to do only when that library is active and no switch is in flight. A switch still in
    // flight (browser Back into another library's class) may move the app elsewhere, or fail: queue
    // this one behind it and land on Today (a switch to the library already active does nothing).
    if (root === activeRoot && pendingRoot === null) {
      return;
    }
    try {
      await switchRoot.mutateAsync(root);
      void navigate({ to: "/" });
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
      void navigate({ ...classPath(slug, "overview"), search: { root: activeRoot } });
    } catch (error) {
      setClassError(String(error));
    }
  };

  return (
    <SidebarContent className="gap-0.5 p-2">
      <NavRow
        label="Today"
        to="/"
        count={due.known && due.total > 0 ? `${due.total} due` : null}
        active={pathname === "/" || pathname === "/welcome"}
        className="font-semibold"
        onSelect={() => {
          if (isMobile) {
            setOpen(false);
          }
        }}
      />
      <div className="h-2" aria-hidden />
      {roots.map((entry, index) => (
        <RootGroup
          key={entry.path}
          entry={entry}
          all={roots}
          first={index === 0}
          activeRoot={activeRoot}
          activeCourse={activeCourse}
          dueByClass={due.byClass}
          onCourseSelect={onCourseSelect}
          onRootSelect={(root) => void onLibrarySelect(root)}
        />
      ))}
      {settings.isSuccess && roots.length === 0 ? (
        <p className="h-6 px-2 text-label font-semibold leading-6 text-faint-foreground">My library</p>
      ) : null}
      {addingClass ? (
        <div className="space-y-1 px-1 py-2">
          <Input
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            placeholder="Class name"
            aria-label="Class name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void onCreateClass();
              }
            }}
          />
          {classError ? <p className="text-micro text-destructive">{classError}</p> : null}
          <Button size="sm" className="w-full" onClick={() => void onCreateClass()}>
            Create class
          </Button>
        </div>
      ) : null}
      <button
        type="button"
        className="mt-1 w-fit rounded-md px-2 py-1.5 text-left text-small text-muted-foreground outline-none transition-colors duration-fast ease-out-soft hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setAddingClass((v) => !v)}
      >
        + Add class
      </button>
    </SidebarContent>
  );
}

/** The class sidebar: Today, one group per library with due counts, + Add class. In Settings it becomes the settings nav. */
export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const inSettings = pathname.startsWith("/settings");

  return (
    <Sidebar collapsible="offcanvas">
      {inSettings ? <SettingsNav /> : <LibrarySidebar />}
    </Sidebar>
  );
}

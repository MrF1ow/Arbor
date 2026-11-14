import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { EmptyState } from "~/components/app/empty-state";
import { ClassWorkspace } from "~/components/workspace/class-workspace";
import { courseDisplayName } from "~/domain/course";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { canUseDesktopIpc } from "~/domain/tauri";
import { useSwitchActiveRootMutation } from "~/lib/queries/active-root";
import { qk } from "~/lib/queries/keys";
import { fetchCourses, useCourses } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";
import { useUiStore } from "~/stores/ui-store";

export const Route = createFileRoute("/course/$course")({
  component: CourseLayout,
});

function CourseLayout() {
  const { course } = Route.useParams();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const courses = useCourses(activeRoot);
  const setLastCourse = useUiStore((s) => s.setLastCourse);

  useEffect(() => {
    if (!activeRoot || !course) {
      return;
    }
    const list = courses.data;
    if (list == null) {
      return;
    }
    if (list.includes(course)) {
      setLastCourse({ root: activeRoot, course });
    }
  }, [activeRoot, course, courses.data, setLastCourse]);

  const exists = (courses.data ?? []).includes(course);
  const missing = courses.isSuccess && !exists;

  // Class routes only look in the active library, but a link (browser Back after Today, Search,
  // Start review or Drill switched library) can name a class of another configured one: find it
  // there and switch to it, as `useOpenClass` does, instead of reporting it missing.
  const otherRoots = (settings.data?.knowledge_roots ?? [])
    .map((entry) => entry.path)
    .filter((path) => path !== activeRoot);
  const lookups = useQueries({
    queries: otherRoots.map((root) => ({
      queryKey: qk.courses(root),
      queryFn: () => fetchCourses(root),
      enabled: missing && canUseDesktopIpc(),
    })),
  });
  const foundRoot = missing ? otherRoots.find((_, i) => lookups[i]?.data?.includes(course)) : undefined;
  const searching = missing && foundRoot === undefined && lookups.some((q) => q.isPending);
  const { mutateAsync: switchRoot } = useSwitchActiveRootMutation();
  const switching = useRef<string | null>(null);
  useEffect(() => {
    if (!foundRoot) {
      switching.current = null;
      return;
    }
    if (switching.current === foundRoot) {
      return;
    }
    switching.current = foundRoot;
    switchRoot(foundRoot).catch((error: unknown) => {
      switching.current = null;
      toast.error(String(error));
    });
  }, [foundRoot, switchRoot]);

  if (missing && (foundRoot !== undefined || searching)) {
    // Looking in the other libraries, or switching to the one that has it.
    return <div className="flex min-h-0 flex-1" />;
  }

  if (missing) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState
          icon={BookOpen}
          title="Class not found"
          description={`${courseDisplayName(course)} is not in any of your libraries.`}
          actions={
            <Link to="/" className="text-sm text-primary underline-offset-2 hover:underline">
              Back to Today
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ClassWorkspace course={course} />
    </div>
  );
}

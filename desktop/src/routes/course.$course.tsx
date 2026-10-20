import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";

import { ActionBar } from "~/components/app/action-bar";
import { CourseHeader } from "~/components/app/course-header";
import { useShellContext } from "~/components/app/shell-context";
import { EmptyState } from "~/components/app/empty-state";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useCourses } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";
import { useUiStore } from "~/stores/ui-store";
import { courseDisplayName } from "~/domain/course";
import { BookOpen } from "lucide-react";

export const Route = createFileRoute("/course/$course")({
  component: CourseLayout,
});

function CourseLayout() {
  const { course } = Route.useParams();
  const { onOpenSearch } = useShellContext();
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

  if (courses.isSuccess && !exists) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState
          icon={BookOpen}
          title="Class not found"
          description={`${courseDisplayName(course)} is not in the active library.`}
          actions={
            <Link to="/welcome" className="text-sm text-primary underline-offset-2 hover:underline">
              Back to welcome
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CourseHeader course={course} onOpenSearch={onOpenSearch} />
      <ActionBar course={course} />
      <div className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}

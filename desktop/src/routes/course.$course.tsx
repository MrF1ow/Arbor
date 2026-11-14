import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { useEffect } from "react";

import { EmptyState } from "~/components/app/empty-state";
import { ClassWorkspace } from "~/components/workspace/class-workspace";
import { courseDisplayName } from "~/domain/course";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useCourses } from "~/lib/queries/library";
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
      <ClassWorkspace course={course} />
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";

import { QuizView } from "~/components/quiz/quiz-view";
import { classSearchFrom, type ClassSearch } from "~/lib/class-path";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useDigests } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";

export const Route = createFileRoute("/course/$course/practice/quiz")({
  validateSearch: (search: Record<string, unknown>): ClassSearch => classSearchFrom(search),
  component: PracticeQuizRoute,
});

// Thin route over the existing quiz view; the Practice rebuild replaces it.
function PracticeQuizRoute() {
  const { course } = Route.useParams();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const digests = useDigests(activeRoot, course);

  return (
    <QuizView key={`${activeRoot ?? ""}|${course}`} course={course} digests={digests.data ?? []} />
  );
}

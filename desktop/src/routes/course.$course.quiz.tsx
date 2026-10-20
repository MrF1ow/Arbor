import { createFileRoute } from "@tanstack/react-router";

import { QuizView } from "~/components/quiz/quiz-view";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useDigests } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";

export const Route = createFileRoute("/course/$course/quiz")({
  component: QuizRoute,
});

function QuizRoute() {
  const { course } = Route.useParams();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const digests = useDigests(activeRoot, course);

  return (
    <QuizView key={`${activeRoot ?? ""}|${course}`} course={course} digests={digests.data ?? []} />
  );
}

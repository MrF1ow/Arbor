import { toast } from "sonner";

import {
  ClassCards,
  ContinueReadingCard,
  NextExamCard,
  QuizAccuracyCard,
  ReviewCard,
  TodayLoadingCard,
  WeakTopicsCard,
} from "~/components/today/today-sections";
import { formatToday } from "~/components/today/today-model";
import { useContinueReading, useCourseMetaByRoot } from "~/components/today/use-today-data";
import { useStartReview } from "~/components/today/use-start-review";
import { workspaceRootLabel } from "~/domain/course";
import type { TodayCourse } from "~/domain/today";
import { lecturesToSearch } from "~/lib/class-path";
import { useOpenClass } from "~/lib/open-class";
import { useSettings } from "~/lib/queries/settings";
import { useTodayAll } from "~/lib/queries/today";

/**
 * Today (`/`): a summary across every library (Q7). Each library answers on its own: a failing one
 * is named in an inline alert and a slow one does not hold the others back.
 */
export function TodayPage() {
  const settings = useSettings();
  const roots = settings.data?.knowledge_roots ?? [];
  const { summary, pending } = useTodayAll();
  const courses = summary?.courses ?? [];
  const meta = useCourseMetaByRoot(roots.map((entry) => entry.path));
  const continueReading = useContinueReading(courses);
  const review = useStartReview(courses);
  const openClass = useOpenClass();

  const libraryLabel = (root: string) => {
    const entry = roots.find((candidate) => candidate.path === root);
    return entry ? workspaceRootLabel(entry, roots) : root;
  };

  const open = (course: TodayCourse) =>
    void openClass(course.root, course.course, "overview").catch((error) => toast.error(String(error)));

  const dueCourses = courses.filter((c) => c.due_ids.length > 0);
  const dueCards = dueCourses.reduce((sum, c) => sum + c.due_ids.length, 0);
  const errors = summary?.errors ?? [];

  return (
    <div data-testid="today-page" className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-col gap-5 px-6 pt-5.5 pb-8">
        <header className="flex flex-col">
          <h1 className="text-title text-foreground">Today</h1>
          <p className="text-small text-muted-foreground">{formatToday(new Date())}</p>
        </header>

        {errors.length > 0 ? (
          <div role="alert" className="flex flex-col gap-1 rounded-lg bg-destructive-surface px-3 py-2 text-small text-destructive">
            {errors.map((error) => (
              <p key={error.root}>{`Couldn't load ${libraryLabel(error.root)}: ${error.message}`}</p>
            ))}
          </div>
        ) : null}
        {pending.length > 0 && summary ? (
          <p className="text-small text-muted-foreground">
            {`Still loading ${pending.map(libraryLabel).join(", ")}…`}
          </p>
        ) : null}

        {summary && !(courses.length === 0 && errors.length > 0) ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <ReviewCard
                dueCards={dueCards}
                dueClasses={dueCourses.length}
                starting={review.starting}
                onStart={() => void review.start()}
              />
              <NextExamCard exam={summary.next_exam} courses={courses} meta={meta} />
              <QuizAccuracyCard accuracy={summary.quiz_accuracy} />
            </div>
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <ContinueReadingCard
                items={continueReading.items}
                meta={meta}
                loading={continueReading.isLoading}
                onOpen={(item) =>
                  void openClass(item.root, item.course, { tab: "read", digest: item.slug }).catch((error) =>
                    toast.error(String(error)),
                  )
                }
              />
              <WeakTopicsCard
                topics={summary.weak_topics}
                meta={meta}
                onDrill={(topic) =>
                  void openClass(topic.root, topic.course, "quiz", {
                    lectures: lecturesToSearch([topic.digest]),
                  }).catch((error) => toast.error(String(error)))
                }
              />
            </div>
            {courses.length > 0 ? <ClassCards courses={courses} meta={meta} onOpen={open} /> : null}
          </>
        ) : summary ? null : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <TodayLoadingCard label="Review" testId="today-review" />
            <TodayLoadingCard label="Next exam" testId="today-next-exam" />
            <TodayLoadingCard label="Quiz accuracy" testId="today-quiz-accuracy" />
          </div>
        )}
      </div>
    </div>
  );
}


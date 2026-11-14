import { CourseSwatch } from "~/components/app/course-swatch";
import {
  accuracyCaption,
  accuracyPercent,
  daysLeftLabel,
  formatExamDate,
  reviewMinutes,
  type ContinueItem,
} from "~/components/today/today-model";
import { Button } from "~/components/ui/button";
import { StudyProgressBar } from "~/components/study/study-progress-bar";
import { Skeleton } from "~/components/ui/skeleton";
import { courseDisplayName } from "~/domain/course";
import type { CourseMetaMap } from "~/domain/course-icons";
import type { TodayCourse, TodaySummary } from "~/domain/today";
import { cn } from "~/lib/utils";

export type MetaByRoot = Record<string, CourseMetaMap | undefined>;

/** A white card with the design's small caps label. */
export function TodayCard({
  label,
  testId,
  className,
  children,
}: {
  label: string;
  testId: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      aria-label={label}
      className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-card p-4 shadow-card", className)}
    >
      <h2 className="text-label text-muted-foreground">{label}</h2>
      {children}
    </section>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="flex" aria-hidden>
      <StudyProgressBar ratio={percent / 100} />
    </div>
  );
}

export function TodayLoadingCard({ label, testId }: { label: string; testId: string }) {
  return (
    <TodayCard label={label} testId={testId} className="gap-3">
      <Skeleton className="mt-2 h-8 w-32" />
      <Skeleton className="h-4 w-40" />
    </TodayCard>
  );
}

export function ReviewCard({
  dueCards,
  dueClasses,
  starting,
  onStart,
}: {
  dueCards: number;
  dueClasses: number;
  starting: boolean;
  onStart: () => void;
}) {
  if (dueCards === 0) {
    return (
      <TodayCard label="Review" testId="today-review">
        <p className="mt-2 text-display text-foreground">Nothing due</p>
        <p className="mt-2.5 text-small text-muted-foreground">Cards you grade will come back here when they are due.</p>
      </TodayCard>
    );
  }
  return (
    <TodayCard label="Review" testId="today-review">
      <p className="mt-2 text-display text-foreground">{dueCards === 1 ? "1 card" : `${dueCards} cards`}</p>
      <p className="mt-2.5 text-small text-muted-foreground">
        {`due across ${dueClasses === 1 ? "1 class" : `${dueClasses} classes`} · about ${reviewMinutes(dueCards)} min`}
      </p>
      <div className="mt-2.5">
        <Button size="sm" disabled={starting} onClick={onStart}>
          Start review
        </Button>
      </div>
    </TodayCard>
  );
}

export function NextExamCard({
  exam,
  courses,
  meta,
}: {
  exam: TodaySummary["next_exam"];
  courses: TodayCourse[];
  meta: MetaByRoot;
}) {
  if (!exam) {
    return (
      <TodayCard label="Next exam" testId="today-next-exam">
        <p className="mt-2 text-display text-foreground">No exam set</p>
        <p className="mt-2.5 text-small text-muted-foreground">Set an exam date on a class overview to count down to it.</p>
      </TodayCard>
    );
  }
  const row = courses.find((c) => c.root === exam.root && c.course === exam.course);
  const plan = row?.plan && row.plan.total > 0 ? Math.round((row.plan.done / row.plan.total) * 100) : null;
  return (
    <TodayCard label="Next exam" testId="today-next-exam">
      <p className="mt-2 text-display text-foreground">{daysLeftLabel(exam.days_to_exam)}</p>
      <p className="mt-2.5 flex min-w-0 items-center gap-2 text-small text-muted-foreground">
        <CourseSwatch meta={meta[exam.root]} course={exam.course} />
        <span className="truncate">{`${courseDisplayName(exam.course)} · ${formatExamDate(exam.exam_date)}`}</span>
      </p>
      {plan !== null ? (
        <>
          <div className="mt-2.5">
            <ProgressBar percent={plan} />
          </div>
          <p className="mt-2.5 text-small text-muted-foreground">{`Study plan ${plan}% done`}</p>
        </>
      ) : null}
    </TodayCard>
  );
}

export function QuizAccuracyCard({ accuracy }: { accuracy: TodaySummary["quiz_accuracy"] }) {
  const percent = accuracyPercent(accuracy.this_week);
  return (
    <TodayCard label="Quiz accuracy" testId="today-quiz-accuracy">
      <p className="mt-2 text-display text-foreground">{percent === null ? "–" : `${percent}%`}</p>
      <p className="mt-2.5 text-small text-muted-foreground">
        {percent === null ? "No quiz answers this week" : accuracyCaption(accuracy.this_week, accuracy.last_week)}
      </p>
    </TodayCard>
  );
}

const ROW = "flex min-w-0 items-center gap-2.5 border-b border-border py-2.5 last:border-b-0";

export function ContinueReadingCard({
  items,
  meta,
  loading,
  onOpen,
}: {
  items: ContinueItem[];
  meta: MetaByRoot;
  loading: boolean;
  onOpen: (item: ContinueItem) => void;
}) {
  return (
    <TodayCard label="Continue reading" testId="today-continue" className="gap-1.5">
      {loading ? (
        <Skeleton className="mt-2 h-5 w-full" />
      ) : items.length === 0 ? (
        <p className="mt-2 text-small text-muted-foreground">Nothing to read yet</p>
      ) : (
        <ul className="mt-1">
          {items.map((item) => (
            <li key={`${item.root}::${item.digest}`}>
              <button
                type="button"
                className={cn(
                  ROW,
                  "w-full text-left outline-none transition-colors duration-fast ease-out-soft hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                )}
                onClick={() => onOpen(item)}
              >
                <CourseSwatch meta={meta[item.root]} course={item.course} />
                <span className="min-w-0 flex-1 truncate text-small text-foreground">{item.title}</span>
                <span className="shrink-0 rounded-xs bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">
                  {item.fraction === null ? "New" : `${Math.round(item.fraction * 100)}% read`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </TodayCard>
  );
}

export function WeakTopicsCard({
  topics,
  meta,
  onDrill,
}: {
  topics: TodaySummary["weak_topics"];
  meta: MetaByRoot;
  onDrill: (topic: TodaySummary["weak_topics"][number]) => void;
}) {
  return (
    <TodayCard label="Weak topics" testId="today-weak" className="gap-1.5">
      {topics.length === 0 ? (
        <p className="mt-2 text-small text-muted-foreground">No weak topics</p>
      ) : (
        <ul className="mt-1">
          {topics.slice(0, 4).map((topic) => (
            <li key={`${topic.root}::${topic.digest}::${topic.heading ?? ""}::${topic.label}`} className={cn(ROW, "py-2")}>
              <CourseSwatch meta={meta[topic.root]} course={topic.course} />
              <span className="min-w-0 flex-1 truncate text-small text-foreground">{topic.label}</span>
              {Number.isFinite(topic.wrong) && Number.isFinite(topic.correct) ? (
                <span className="shrink-0 rounded-xs bg-destructive-surface px-1.5 py-0.5 text-micro text-destructive">
                  {`${topic.wrong} of ${topic.wrong + topic.correct}`}
                </span>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                aria-label={`Drill ${topic.label}`}
                onClick={() => onDrill(topic)}
              >
                Drill
              </Button>
            </li>
          ))}
        </ul>
      )}
    </TodayCard>
  );
}

function classCaption(course: TodayCourse): string {
  const lectures = `${course.digest_count} ${course.digest_count === 1 ? "lecture" : "lectures"}`;
  const cards = course.due_ids.length;
  return `${lectures} · ${cards > 0 ? `${cards} cards due` : "no cards due"}`;
}

export function ClassCards({
  courses,
  meta,
  onOpen,
}: {
  courses: TodayCourse[];
  meta: MetaByRoot;
  onOpen: (course: TodayCourse) => void;
}) {
  return (
    <section data-testid="today-classes" aria-label="Your classes" className="flex flex-col gap-3">
      <h2 className="text-heading text-foreground">Your classes</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {courses.map((course) => {
          const mastery = course.mastery === null ? null : Math.round(course.mastery * 100);
          return (
            <button
              key={`${course.root}::${course.course}`}
              type="button"
              className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-card p-4 text-left shadow-card outline-none transition-colors duration-fast ease-out-soft hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpen(course)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <CourseSwatch meta={meta[course.root]} course={course.course} />
                <span className="min-w-0 truncate text-small font-semibold text-foreground">
                  {courseDisplayName(course.course)}
                </span>
              </span>
              <span className="text-small text-muted-foreground">
                {course.error ? "Couldn't read this class" : classCaption(course)}
              </span>
              <ProgressBar percent={mastery ?? 0} />
              <span className="text-small text-muted-foreground">
                {mastery === null ? "No cards yet" : `${mastery}% mastered`}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

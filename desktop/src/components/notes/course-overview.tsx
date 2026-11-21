import { useNavigate } from "@tanstack/react-router";
import { CalendarDays, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatExamDate, reviewMinutes, daysLeftLabel, accuracyCaption, accuracyPercent } from "~/components/today/today-model";
import { resetClassDeck } from "~/components/study/reset-class-deck";
import { PreviewBarRight } from "~/components/workspace/preview-bar";
import { parseExamDate, toExamDate, useExamDateField } from "~/components/workspace/use-exam-date";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Calendar } from "~/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";
import { courseDisplayName } from "~/domain/course";
import { toCourseDigest, type ReadingEntry } from "~/domain/lectures";
import { VIEWER_WRITE_REASON, viewerBlocksWrite } from "~/domain/library-role";
import { arborDigestTarget, headingId, renderMarkdown } from "~/domain/markdown";
import { daysUntil, resolveDigestSlug } from "~/domain/notes";
import { PROVIDER_FALLBACK, signedOutJobMessage } from "~/domain/provider";
import type { CourseOverviewPayload, DigestInfo, StudyRecommendItem } from "~/domain/types";
import { fetchAuthStatus } from "~/lib/auth-refresh";
import { classPath, lecturesToSearch } from "~/lib/class-path";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useCourseStats, useStudyPlanStatus, useStudyPlanToggle } from "~/lib/queries/class-stats";
import { useEffectiveProvider } from "~/lib/queries/effective-provider";
import { useLibrary } from "~/lib/queries/library";
import { useCourseOverview, useMarkdown } from "~/lib/queries/notes";
import { useReadingState } from "~/lib/queries/reading-state";
import { useSettings } from "~/lib/queries/settings";
import { useStudyPlanMutation } from "~/lib/queries/study";
import { flushStudyWrites } from "~/lib/study-writes";
import { cn } from "~/lib/utils";
import { useJobStore } from "~/stores/job-store";

/** A weak topic as `study_progress overview` lists it; the counts feed the "4 of 9" tag. */
type WeakTopic = CourseOverviewPayload["weak"]["topics"][number] & {
  wrong?: number;
  correct?: number;
};

const CARD = "rounded-xl border border-border bg-card p-4 shadow-card";

function StatCard({
  label,
  value,
  caption,
  testId,
}: {
  label: string;
  value: string;
  caption: string;
  testId: string;
}) {
  return (
    <section data-testid={testId} aria-label={label} className={cn(CARD, "flex min-w-0 flex-col gap-2")}>
      <h3 className="text-label text-muted-foreground">{label}</h3>
      <p className="text-display text-foreground">{value}</p>
      <p className="text-caption text-muted-foreground">{caption}</p>
    </section>
  );
}

function CardTitle({
  children,
  aside,
  id,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h3 id={id} className="min-w-0 flex-1 text-heading text-foreground">
        {children}
      </h3>
      {aside}
    </div>
  );
}

/** The worker labels an unread lecture "Read <file name>"; show its title ("Read Membrane transport"). */
function recommendedLabel(item: StudyRecommendItem, course: string, digests: DigestInfo[]): string {
  if (item.kind !== "unreviewed_digest" || !item.digest) {
    return item.label;
  }
  const wanted = toCourseDigest(course, item.digest);
  const lecture = digests.find((d) => toCourseDigest(course, d.path) === wanted);
  return lecture ? `Read ${lecture.title}` : item.label;
}

/**
 * The right-hand note on a recommendation, where the data gives one. A digest the worker calls
 * unreviewed (no card or quiz answer seen yet) takes its note from the reading state, as the
 * lecture column does (Q26): New when never opened, "N% read" part-way, nothing once read.
 */
function recommendedMeta(
  item: StudyRecommendItem & { count?: number },
  course: string,
  reading: Record<string, ReadingEntry> | undefined,
): string | null {
  if (item.kind === "unreviewed_digest") {
    if (!item.digest || !reading) {
      return null;
    }
    const entry = reading[toCourseDigest(course, item.digest)];
    if (!entry) {
      return "New";
    }
    return entry.read ? null : `${Math.round(entry.fraction * 100)}% read`;
  }
  if (item.kind === "due_cards" && typeof item.count === "number" && item.count > 0) {
    return `${reviewMinutes(item.count)} min`;
  }
  return null;
}

/**
 * Overview (design "Class · Overview"): the stat cards, the study plan as a checklist, weak topics
 * with Drill, Recommended, and the exam date.
 */
export function CourseOverview({
  course,
  digests,
  heading,
}: {
  course: string;
  digests: DigestInfo[];
  /** A section to scroll to, from a search hit (`?heading=Study plan`). */
  heading?: string;
}) {
  const navigate = useNavigate();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const library = useLibrary(activeRoot);
  const role = library.data?.present === true ? library.data.role : null;
  const viewerBlocked = viewerBlocksWrite(role);
  const effective = useEffectiveProvider(activeRoot);
  const appendLog = useJobStore((s) => s.append);

  const [planStatusText, setPlanStatusText] = useState("");
  const [planBusy, setPlanBusy] = useState(false);
  const [flushDone, setFlushDone] = useState(false);
  // Course notes (course.md) opens expanded: search hits and chat citations land here, and the
  // text they point at must be visible. It still folds away.
  const [courseNotesOpen, setCourseNotesOpen] = useState(true);
  const paneRef = useRef<HTMLDivElement>(null);

  const overview = useCourseOverview(activeRoot, course, flushDone);
  const stats = useCourseStats(activeRoot, course);
  const plan = useStudyPlanStatus(activeRoot, course);
  const toggleTask = useStudyPlanToggle(activeRoot, course);
  const studyPlanMutation = useStudyPlanMutation(activeRoot, course);
  const exam = useExamDateField(activeRoot, course, viewerBlocked);
  const examDate = exam.saved || null;
  const courseMd = useMarkdown(activeRoot, `${course}/course.md`);
  const readingState = useReadingState(activeRoot);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await flushStudyWrites(3000);
      if (!cancelled) {
        setFlushDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [course, activeRoot]);

  useEffect(() => {
    if (overview.isError && overview.error) {
      const message =
        overview.error instanceof Error ? overview.error.message : String(overview.error);
      appendLog(`Could not load course overview: ${message}`);
    }
  }, [overview.isError, overview.error, appendLog]);

  const courseNotesHtml =
    courseMd.isSuccess && courseMd.data.trim() !== "" ? renderMarkdown(courseMd.data).html : "";

  // A `?heading=` from a search hit or a chat citation scrolls to that heading: one of this
  // page's sections ("Course notes" included), or a heading of course.md, once its text shows.
  const headingDone = useRef<string | null>(null);
  useEffect(() => {
    headingDone.current = null;
    const pane = paneRef.current;
    const id = heading ? headingId(heading) : "";
    const target = id ? pane?.querySelector(`#${CSS.escape(id)}`) : null;
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "start" });
      headingDone.current = heading ?? null;
    } else {
      pane?.scrollTo(0, 0);
    }
  }, [heading]);
  useEffect(() => {
    const id = heading ? headingId(heading) : "";
    if (!id || headingDone.current === heading || !courseNotesOpen) {
      return;
    }
    const target = paneRef.current?.querySelector(`#${CSS.escape(id)}`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "start" });
      headingDone.current = heading ?? null;
    }
  }, [heading, courseNotesOpen, courseNotesHtml]);

  const overviewPending = !flushDone || overview.isLoading;
  const overviewError = flushDone && overview.isError;
  const data = overview.data;

  const quizThisWeek = stats.data?.quiz.this_week;
  const quizPercent = quizThisWeek ? accuracyPercent(quizThisWeek) : null;
  const daysLeft = examDate ? daysUntil(examDate, new Date()) : null;
  const examValue = exam.value;
  // The plan request carries the exam date only when it is a real calendar date: an old malformed
  // value in courses.json (`0002-11-04`, `2026-02-30`) never goes out.
  const planExamDate = examValue && parseExamDate(examValue) ? examValue : null;

  const openDigest = (digestRef: string, heading?: string | null) => {
    const slug = resolveDigestSlug(digestRef, digests);
    void navigate({ ...classPath(course, "read", slug), search: heading ? { heading } : {} });
  };

  // A digest link in the rendered course.md carries a relative `digests/…md` href that the webview
  // would follow to an unknown route; open it in Read instead. Any other click is left alone.
  const onCourseNotesClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const anchor = target.closest("a[data-arbor-digest]");
    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }
    const href = anchor.getAttribute("href");
    const digestTarget = href ? arborDigestTarget(href) : null;
    if (!digestTarget) {
      return;
    }
    event.preventDefault();
    openDigest(digestTarget);
  };

  const drill = (digestRef: string) => {
    void navigate({
      ...classPath(course, "quiz"),
      search: { lectures: lecturesToSearch([toCourseDigest(course, digestRef)]) },
    });
  };

  const onGeneratePlan = async () => {
    if (viewerBlocked || !effective.providerId) {
      return;
    }
    const providerId = effective.providerId;
    if (!effective.modelId) {
      setPlanStatusText("Select a model in Settings.");
      return;
    }
    try {
      const auth = await fetchAuthStatus(providerId, true);
      if (!auth.authenticated) {
        const label = PROVIDER_FALLBACK.find((p) => p.id === providerId)?.label ?? providerId;
        setPlanStatusText(signedOutJobMessage(label, auth.reason ?? ""));
        return;
      }
      setPlanBusy(true);
      setPlanStatusText("Generating study plan…");
      await studyPlanMutation.mutateAsync({
        provider: providerId,
        model: effective.modelId,
        examDate: planExamDate,
      });
      setPlanStatusText("");
    } catch (error) {
      setPlanStatusText(String(error));
    } finally {
      setPlanBusy(false);
    }
  };

  const weakTopics = (overviewError ? [] : (data?.weak.topics ?? [])) as WeakTopic[];
  const recommended: StudyRecommendItem[] = overviewError ? [] : (data?.recommend.items ?? []);
  const tasks = plan.data?.tasks ?? [];

  return (
    <div
      ref={paneRef}
      data-testid="overview-pane"
      className="@container/overview min-h-0 flex-1 overflow-y-auto px-10 pb-10 pt-6"
    >
      <PreviewBarRight>{digests.length === 1 ? "1 lecture" : `${digests.length} lectures`}</PreviewBarRight>
      <h2 className="text-title text-foreground">Course overview</h2>
      <p className="mt-1 text-caption text-muted-foreground">
        {[
          courseDisplayName(course),
          digests.length === 1 ? "1 lecture" : `${digests.length} lectures`,
          examDate ? `exam ${formatExamDate(examDate)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 @2xl/overview:grid-cols-3">
        {overviewPending ? (
          <Skeleton className="h-28 w-full @2xl/overview:col-span-3" />
        ) : data && data.due.deck_count > 0 ? (
          <StatCard
            testId="overview-due"
            label="Cards due today"
            value={data.due.count === 1 ? "1 card" : `${data.due.count} cards`}
            caption={
              data.due.count > 0
                ? `about ${reviewMinutes(data.due.count)} min · ${data.due.deck_count} in the deck`
                : `${data.due.deck_count} in the deck`
            }
          />
        ) : null}
        {quizPercent !== null && quizThisWeek && stats.data ? (
          <StatCard
            testId="overview-quiz"
            label="Quiz accuracy"
            value={`${quizPercent}%`}
            caption={accuracyCaption(quizThisWeek, stats.data.quiz.last_week)}
          />
        ) : null}
        {examDate && daysLeft !== null && daysLeft >= 0 ? (
          <StatCard
            testId="overview-exam"
            label="Exam"
            value={daysLeftLabel(daysLeft)}
            caption={formatExamDate(examDate)}
          />
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 @3xl/overview:grid-cols-2">
        <section className={CARD} aria-label="Study plan">
          <CardTitle
            id={headingId("Study plan")}
            aside={
              <>
                {plan.data && plan.data.total > 0 ? (
                  <span className="rounded-xs bg-accent px-1.5 py-0.5 text-micro text-accent-foreground">
                    {`${plan.data.done} of ${plan.data.total} done`}
                  </span>
                ) : null}
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={viewerBlocked || planBusy || studyPlanMutation.isPending}
                  title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
                  onClick={() => void onGeneratePlan()}
                >
                  {tasks.length > 0 ? "Regenerate" : "Generate"}
                </Button>
              </>
            }
          >
            Study plan
          </CardTitle>
          {plan.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : tasks.length > 0 ? (
            <ul className="flex flex-col gap-2.5">
              {tasks.map((task) => (
                <li key={task.id} className="flex items-center gap-2.5 text-small text-foreground">
                  <Checkbox
                    aria-label={task.text}
                    checked={task.done}
                    disabled={toggleTask.isPending}
                    onCheckedChange={(checked) => toggleTask.mutate({ task: task.id, done: checked })}
                  />
                  <span className="min-w-0 flex-1">{task.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-small text-muted-foreground">No study plan yet.</p>
          )}
          <div className="mt-4 flex items-center gap-2 text-caption text-muted-foreground">
            <span>Exam date</span>
            <ExamDatePicker
              value={examValue}
              disabled={viewerBlocked}
              onPick={exam.commit}
            />
          </div>
          {exam.error ? (
            <p role="alert" className="mt-2 text-small text-destructive">
              Could not save the exam date. Pick the date again to try again.
            </p>
          ) : null}
          {planStatusText ? <p className="mt-2 text-small text-muted-foreground">{planStatusText}</p> : null}
        </section>

        <div className="flex flex-col gap-4">
          <section className={CARD} aria-label="Weak topics">
            <CardTitle>Weak topics</CardTitle>
            {overviewPending ? (
              <Skeleton className="h-16 w-full" />
            ) : overviewError ? (
              <p className="text-small text-muted-foreground">Could not load weak topics.</p>
            ) : weakTopics.length === 0 ? (
              <p className="text-small text-muted-foreground">No weak topics yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {weakTopics.map((topic) => (
                  <li key={topic.label} className="flex items-center gap-3 text-small text-foreground">
                    {topic.digest ? (
                      <button
                        type="button"
                        onClick={() => openDigest(topic.digest!, topic.heading ?? null)}
                        className="min-w-0 flex-1 truncate text-left hover:text-primary"
                      >
                        {topic.label}
                      </button>
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{topic.label}</span>
                    )}
                    {typeof topic.wrong === "number" && typeof topic.correct === "number" ? (
                      <span className="rounded-xs bg-destructive-surface px-1.5 py-0.5 text-micro text-destructive">
                        {`${topic.wrong} of ${topic.wrong + topic.correct}`}
                      </span>
                    ) : null}
                    {topic.digest ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        aria-label={`Drill ${topic.label}`}
                        onClick={() => drill(topic.digest!)}
                      >
                        Drill
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={CARD} aria-label="Recommended">
            <CardTitle>Recommended</CardTitle>
            {overviewPending ? (
              <Skeleton className="h-20 w-full" />
            ) : overviewError ? (
              <p className="text-small text-muted-foreground">Could not load recommendations.</p>
            ) : recommended.length === 0 ? (
              <p className="text-small text-muted-foreground">No recommendations yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {recommended.map((item) => (
                  <li key={`${item.kind}-${item.label}`}>
                    <button
                      type="button"
                      onClick={() => {
                        if (item.kind === "due_cards") {
                          if (activeRoot) {
                            resetClassDeck(activeRoot, course);
                          }
                          void navigate({ ...classPath(course, "cards"), search: {} });
                        } else if (item.digest) {
                          openDigest(item.digest, item.heading ?? null);
                        }
                      }}
                      className="flex w-full items-center gap-2.5 text-left text-small text-foreground hover:text-primary"
                    >
                      <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
                      <span className="min-w-0 flex-1 truncate">{recommendedLabel(item, course, digests)}</span>
                      {recommendedMeta(item, course, readingState.data) ? (
                        <span className="shrink-0 text-caption text-muted-foreground">
                          {recommendedMeta(item, course, readingState.data)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {courseNotesHtml ? (
        <section id={headingId("Course notes")} className={cn(CARD, "mt-4")} aria-label="Course notes">
          <button
            type="button"
            aria-expanded={courseNotesOpen}
            onClick={() => setCourseNotesOpen((open) => !open)}
            className="flex w-full items-center gap-2 text-left text-heading text-foreground"
          >
            <ChevronRight
              aria-hidden
              className={cn("size-icon-sm text-muted-foreground transition-transform", courseNotesOpen && "rotate-90")}
            />
            Course notes
          </button>
          {courseNotesOpen ? (
            <div
              className="prose-arbor mt-3"
              onClick={onCourseNotesClick}
              dangerouslySetInnerHTML={{ __html: courseNotesHtml }}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

const EXAM_START_MONTH = new Date(1900, 0, 1);
const EXAM_END_MONTH = new Date(2100, 11, 1);

function formatExamDateLong(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The exam date: a button reading the date (or "No exam date") that opens Arbor's own calendar,
 * the same on every platform (a native date input opens a GTK popup that traps focus on Linux).
 * Picking a day saves it and closes; Clear saves `""`; Escape and a click outside close without saving.
 */
export function ExamDatePicker({
  value,
  disabled,
  onPick,
}: {
  /** The exam date as `YYYY-MM-DD`, or `""` when none. */
  value: string;
  disabled: boolean;
  /** Called with `YYYY-MM-DD` for a picked day, or `""` for Clear. */
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseExamDate(value);
  const label = selected ? formatExamDateLong(selected) : "No exam date";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            title={disabled ? VIEWER_WRITE_REASON : undefined}
            aria-label="Exam date"
            className={cn("min-w-40 justify-start", !selected && "text-muted-foreground")}
          />
        }
      >
        <CalendarDays aria-hidden="true" />
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-2">
        <Calendar
          mode="single"
          required
          selected={selected}
          defaultMonth={selected ?? new Date()}
          startMonth={EXAM_START_MONTH}
          endMonth={EXAM_END_MONTH}
          onSelect={(day) => {
            onPick(toExamDate(day));
            setOpen(false);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={value === ""}
          onClick={() => {
            onPick("");
            setOpen(false);
          }}
        >
          Clear
        </Button>
      </PopoverContent>
    </Popover>
  );
}

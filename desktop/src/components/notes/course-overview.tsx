import { useNavigate } from "@tanstack/react-router";
import { GraduationCap, House, Info, Layers } from "lucide-react";
import { useEffect, useState } from "react";

import { Chip } from "~/components/app/chip";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { courseDisplayName } from "~/domain/course";
import { VIEWER_WRITE_REASON, viewerBlocksWrite } from "~/domain/library-role";
import {
  daysUntil,
  digestFlags,
  digestSlugFromPath,
  examDateFromPlan,
  examFocusCallout,
  firstParagraph,
  quizAccuracy,
  unreviewedDigestRecommend,
  weakestRecommendTopic,
} from "~/domain/notes";
import { renderMarkdown } from "~/domain/markdown";
import { PROVIDER_FALLBACK, signedOutJobMessage } from "~/domain/provider";
import { parseQuizProgress } from "~/domain/quiz";
import type { CourseOverviewPayload, DigestInfo, StudyRecommendItem } from "~/domain/types";
import { fetchAuthStatus } from "~/lib/auth-refresh";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useEffectiveProvider } from "~/lib/queries/effective-provider";
import { useLibrary } from "~/lib/queries/library";
import { useCourseOverview, useMarkdown } from "~/lib/queries/notes";
import { useQuizProgress, useStudyPlan, useStudyPlanMutation } from "~/lib/queries/study";
import { useSettings } from "~/lib/queries/settings";
import { flushStudyWrites } from "~/lib/study-writes";
import { useJobStore } from "~/stores/job-store";

function padUnitNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function RecommendList({
  items,
  loading,
  error,
  course,
  onNavigateDigest,
}: {
  items: StudyRecommendItem[] | undefined;
  loading: boolean;
  error: boolean;
  course: string;
  onNavigateDigest: (digest: string, heading?: string | null) => void;
}) {
  const navigate = useNavigate();
  if (loading) {
    return <Skeleton className="h-20 w-full" />;
  }
  if (error) {
    return <p className="text-sm text-muted-foreground">Could not load recommendations.</p>;
  }
  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground">No recommendations yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Chip
          key={`${item.kind}-${item.label}`}
          onClick={() => {
            if (item.kind === "due_cards") {
              void navigate({ to: "/course/$course/flashcards", params: { course } });
              return;
            }
            if (
              (item.kind === "weakest_topic" || item.kind === "unreviewed_digest") &&
              item.digest
            ) {
              onNavigateDigest(item.digest, item.heading ?? null);
            }
          }}
        >
          {item.label}
        </Chip>
      ))}
    </div>
  );
}

function WeakTopicsList({
  topics,
  loading,
  error,
  onNavigateDigest,
}: {
  topics: CourseOverviewPayload["weak"]["topics"] | undefined;
  loading: boolean;
  error: boolean;
  onNavigateDigest: (digest: string, heading?: string | null) => void;
}) {
  if (loading) {
    return <Skeleton className="h-16 w-full" />;
  }
  if (error) {
    return <p className="text-sm text-muted-foreground">Could not load weak topics.</p>;
  }
  const withDigest = (topics ?? []).filter((t) => t.digest);
  if (withDigest.length === 0) {
    return <p className="text-sm text-muted-foreground">No weak topics yet.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {withDigest.map((topic) => (
        <li key={topic.label}>
          <Chip
            onClick={() => {
              if (topic.digest) {
                onNavigateDigest(topic.digest, topic.heading ?? null);
              }
            }}
          >
            {topic.label}
          </Chip>
        </li>
      ))}
    </ul>
  );
}

export function CourseOverview({ course, digests }: { course: string; digests: DigestInfo[] }) {
  const navigate = useNavigate();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const library = useLibrary(activeRoot);
  const role = library.data?.present === true ? library.data.role : null;
  const viewerBlocked = viewerBlocksWrite(role);
  const effective = useEffectiveProvider(activeRoot);
  const appendLog = useJobStore((s) => s.append);

  const [examDateOverride, setExamDateOverride] = useState<string | null>(null);
  const [planStatus, setPlanStatus] = useState("");
  const [flushDone, setFlushDone] = useState(false);

  const courseMd = useMarkdown(activeRoot, `${course}/course.md`);
  const studyPlan = useStudyPlan(activeRoot, course);
  const quizProgress = useQuizProgress(activeRoot, course);
  const overview = useCourseOverview(activeRoot, course, flushDone);
  const studyPlanMutation = useStudyPlanMutation(activeRoot, course);

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
    if (overview.isError) {
      appendLog(`Could not load course overview: ${String(overview.error)}`);
    }
  }, [overview.isError, overview.error, appendLog]);

  const goToDigest = (digestRef: string, heading?: string | null) => {
    const match =
      digests.find(
        (d) => digestSlugFromPath(d.path) === digestRef || d.path.endsWith(`/${digestRef}.md`),
      ) ?? null;
    const slug = match ? digestSlugFromPath(match.path) : digestRef.replace(/\.md$/i, "");
    void navigate({
      to: "/course/$course/notes/$digest",
      params: { course, digest: slug },
      search: heading ? { heading } : {},
    });
  };

  const overviewPending = !flushDone || overview.isLoading;
  const overviewError = flushDone && overview.isError;
  const overviewData = overview.data;

  let accuracy: ReturnType<typeof quizAccuracy> = null;
  if (quizProgress.data) {
    try {
      accuracy = quizAccuracy(parseQuizProgress(quizProgress.data));
    } catch {
      accuracy = null;
    }
  }

  const examFromPlan = studyPlan.data ? examDateFromPlan(studyPlan.data) : null;
  const examDate = examDateOverride ?? examFromPlan ?? "";
  const daysLeft = examFromPlan ? daysUntil(examFromPlan, new Date()) : null;

  const flags = overviewData ? digestFlags(overviewData, digests) : new Map();
  const weakest = overviewData ? weakestRecommendTopic(overviewData.recommend.items) : null;
  const unreviewedDigest = overviewData
    ? unreviewedDigestRecommend(overviewData.recommend.items, digests)
    : null;
  const callout = examFocusCallout({
    weakLabel: overviewData?.weak.topics[0]?.label ?? null,
    unreviewedTitle: unreviewedDigest?.title ?? null,
  });

  const courseBody = courseMd.data ?? "";
  const lede = courseMd.isSuccess ? firstParagraph(courseBody) : null;
  const courseNotesHtml = courseMd.isSuccess ? renderMarkdown(courseBody).html : "";
  const planHtml =
    studyPlan.isSuccess && studyPlan.data.trim() !== ""
      ? renderMarkdown(studyPlan.data).html
      : null;

  const onGeneratePlan = async () => {
    if (viewerBlocked) {
      return;
    }
    if (!effective.modelId) {
      setPlanStatus("Select a model in Settings.");
      return;
    }
    setPlanStatus("Generating study plan…");
    try {
      const auth = await fetchAuthStatus(effective.providerId, true);
      if (!auth.authenticated) {
        const label =
          PROVIDER_FALLBACK.find((p) => p.id === effective.providerId)?.label ??
          effective.providerId;
        setPlanStatus(signedOutJobMessage(label, auth.reason ?? ""));
        return;
      }
      await studyPlanMutation.mutateAsync({
        provider: effective.providerId,
        model: effective.modelId,
        examDate: examDate.trim() || null,
      });
      setPlanStatus("");
    } catch (error) {
      setPlanStatus(String(error));
    }
  };

  return (
    <div className="mx-auto w-full max-w-reading px-8 py-9 pb-16 font-serif text-read">
      <div className="notes-eyebrow">
        <House className="size-icon-sm" aria-hidden />
        <span>Course overview</span>
      </div>
      <h2 className="mb-2 font-serif text-3xl font-medium leading-tight">
        {courseDisplayName(course)}
      </h2>
      {courseMd.isLoading ? (
        <Skeleton className="mb-6 h-4 w-full max-w-md" />
      ) : lede ? (
        <p className="notes-lede">{lede}</p>
      ) : courseMd.isError ? (
        <p className="notes-lede text-muted-foreground">
          No notes yet. Add lecture files, then Update knowledge.
        </p>
      ) : null}

      {overviewPending ? (
        <Skeleton className="notes-stats mb-6 h-24 w-full" />
      ) : overviewData ? (
        <div className="notes-stats">
          {overviewData.due.deck_count > 0 ? (
            <div className="notes-stat">
              <div className="notes-stat-label">Cards due today</div>
              <div className="notes-stat-value">
                {overviewData.due.count}
                <small>of {overviewData.due.deck_count}</small>
              </div>
            </div>
          ) : null}
          {accuracy ? (
            <div className="notes-stat">
              <div className="notes-stat-label">Quiz accuracy</div>
              <div className="notes-stat-value">
                {accuracy.percent}%
                <small>{accuracy.answerCount} answers</small>
              </div>
            </div>
          ) : null}
          {daysLeft != null && daysLeft >= 0 ? (
            <div className="notes-stat">
              <div className="notes-stat-label">Exam</div>
              <div className="notes-stat-value">
                {daysLeft === 0 ? "today" : daysLeft}
                {daysLeft !== 0 ? <small>days away</small> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {overviewData ? (
        <div className="notes-next mb-6">
          {overviewData.due.count > 0 ? (
            <Button
              size="lg"
              onClick={() => {
                void navigate({ to: "/course/$course/flashcards", params: { course } });
              }}
            >
              <Layers className="size-icon-sm" />
              Review {overviewData.due.count} due cards
            </Button>
          ) : null}
          <Button
            size="lg"
            variant="outline"
            disabled={!weakest}
            onClick={() => {
              if (!weakest) {
                return;
              }
              void navigate({
                to: "/course/$course/chat",
                params: { course },
                search: {
                  mode: "explain",
                  prompt: `Explain the weakest topic "${weakest.label}". Stay inside this course and cite sources.`,
                },
              });
            }}
          >
            <GraduationCap className="size-icon-sm" />
            Explain weakest topic
          </Button>
        </div>
      ) : null}

      <h3 className="notes-section-title">Course map</h3>
      {overviewPending ? (
        <Skeleton className="mb-6 h-32 w-full" />
      ) : (
        <ul className="notes-units mb-6">
          {digests.map((digest, index) => {
            const flag = flags.get(digest.path);
            return (
              <li key={digest.path}>
                <button
                  type="button"
                  className="notes-unit-row"
                  onClick={() => goToDigest(digestSlugFromPath(digest.path))}
                >
                  <span className="notes-unit-no">{padUnitNumber(index)}</span>
                  <span>
                    <span className="notes-unit-title">{digest.title}</span>
                    <span className="notes-unit-sub">{digest.date}</span>
                  </span>
                  {flag ? (
                    <span
                      className={
                        flag === "weak" ? "notes-unit-flag-weak" : "notes-unit-flag-new"
                      }
                    >
                      {flag}
                    </span>
                  ) : (
                    <span className="notes-unit-flag-new" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {callout ? (
        <div className="notes-callout mb-6">
          <Info className="size-icon shrink-0 text-primary" aria-hidden />
          <span>{callout}</span>
        </div>
      ) : null}

      <h3 className="notes-section-title">Recommended</h3>
      <div className="mb-6">
        <RecommendList
          items={overviewError ? undefined : overviewData?.recommend.items}
          loading={overviewPending}
          error={overviewError}
          course={course}
          onNavigateDigest={goToDigest}
        />
      </div>

      <h3 className="notes-section-title">Weak topics</h3>
      <div className="mb-6">
        <WeakTopicsList
          topics={overviewError ? undefined : overviewData?.weak.topics}
          loading={overviewPending}
          error={overviewError}
          onNavigateDigest={goToDigest}
        />
      </div>

      <h3 className="notes-section-title">Study plan</h3>
      <div className="mb-6 space-y-3">
        {studyPlan.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : planHtml ? (
          <div className="prose-arbor" dangerouslySetInnerHTML={{ __html: planHtml }} />
        ) : (
          <p className="text-sm text-muted-foreground">No study plan yet.</p>
        )}
        <div className="flex flex-wrap items-end gap-3 font-sans text-sm">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Exam date</span>
            <Input
              type="date"
              value={examDate}
              onChange={(e) => setExamDateOverride(e.target.value)}
            />
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={viewerBlocked || studyPlanMutation.isPending}
            title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
            onClick={() => void onGeneratePlan()}
          >
            {planHtml ? "Regenerate" : "Generate"}
          </Button>
        </div>
        {planStatus ? <p className="text-sm text-muted-foreground">{planStatus}</p> : null}
      </div>

      <h3 className="notes-section-title">Course notes</h3>
      {courseMd.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : courseMd.isSuccess ? (
        <div className="prose-arbor" dangerouslySetInnerHTML={{ __html: courseNotesHtml }} />
      ) : null}
    </div>
  );
}

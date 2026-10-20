import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { EmptyState } from "~/components/app/empty-state";
import { StudyArtifactToolbar } from "~/components/study/study-artifact-toolbar";
import { StudyColumn, StudyViewShell } from "~/components/study/study-layout";
import { StudyProgressBar } from "~/components/study/study-progress-bar";
import { StudySourceChip } from "~/components/study/study-source-chip";
import { StudyUnverifiedBadge } from "~/components/study/study-unverified-badge";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { courseDisplayName } from "~/domain/course";
import { failedIdsFor, parseCitationsReport } from "~/domain/citations";
import {
  createReview,
  currentQuestion,
  nextReview,
  parseQuizPack,
  parseQuizProgress,
  previousReview,
  selectChoice,
  sessionScore,
  submitChoice,
} from "~/domain/quiz";
import type { DigestInfo, QuizPack, QuizProgress, QuizReview } from "~/domain/types";
import { VIEWER_WRITE_REASON, viewerBlocksWrite } from "~/domain/library-role";
import { PROVIDER_FALLBACK, signedOutJobMessage } from "~/domain/provider";
import { fetchAuthStatus } from "~/lib/auth-refresh";
import { invoke } from "~/lib/ipc";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useEffectiveProvider } from "~/lib/queries/effective-provider";
import { useStartQuizJobMutation } from "~/lib/queries/jobs";
import { useLibrary } from "~/lib/queries/library";
import { qk } from "~/lib/queries/keys";
import { useSettings } from "~/lib/queries/settings";
import { useQuizProgress, useStudyArtifactStale, useStudyJson } from "~/lib/queries/study";
import { isDialogOpen, isEditableTarget } from "~/lib/shortcuts";
import { flushStudyWrites, useEnqueueStudyWrite } from "~/lib/study-writes";
import { useJobStore } from "~/stores/job-store";

function packIdentity(pack: QuizPack): string {
  return `${pack.course}:${pack.questions.map((q) => q.id).join("\0")}`;
}

export function QuizView({
  course,
  digests,
}: {
  course: string;
  digests: DigestInfo[];
}) {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const library = useLibrary(activeRoot);
  const role = library.data?.present === true ? library.data.role : null;
  const viewerBlocked = viewerBlocksWrite(role);
  const effective = useEffectiveProvider(activeRoot);
  const appendLog = useJobStore((s) => s.append);
  const studyJobRunning = useJobStore((s) => s.status) === "running";
  const enqueueWrite = useEnqueueStudyWrite();
  const startJob = useStartQuizJobMutation(activeRoot);

  const [flushDone, setFlushDone] = useState(false);
  const [postFlushReady, setPostFlushReady] = useState(false);
  const [flushAt, setFlushAt] = useState(0);
  const [pack, setPack] = useState<QuizPack | null>(null);
  const [progress, setProgress] = useState<QuizProgress>({});
  const [review, setReview] = useState<QuizReview | null>(null);
  const [sessionIdentity, setSessionIdentity] = useState<string | null>(null);
  const [modelHint, setModelHint] = useState<string | null>(null);

  const lastSyncedDataRef = useRef({ pack: 0, progress: 0 });

  const packQuery = useStudyJson(activeRoot, course, "quiz.json");
  const progressQuery = useQuizProgress(activeRoot, course);
  const citationsQuery = useStudyJson(activeRoot, course, "citations.json");
  const staleQuery = useStudyArtifactStale(activeRoot, course, "quiz");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setFlushDone(false);
      setPostFlushReady(false);
      setFlushAt(0);
      setSessionIdentity(null);
      setPack(null);
      setReview(null);
      setProgress({});
      await flushStudyWrites(3000);
      if (cancelled || !activeRoot) {
        return;
      }
      const flushedAt = Date.now();
      setFlushAt(flushedAt);
      const packKey = qk.studyJson(activeRoot, course, "quiz.json");
      const progressKey = qk.quizProgress(activeRoot, course);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: packKey }),
        queryClient.invalidateQueries({ queryKey: progressKey }),
      ]);
      await Promise.all([
        queryClient
          .fetchQuery({
            queryKey: packKey,
            queryFn: () =>
              invoke<unknown>("read_study_json", {
                root: activeRoot,
                course,
                file: "quiz.json",
              }),
          })
          .catch(() => undefined),
        queryClient
          .fetchQuery({
            queryKey: progressKey,
            queryFn: () =>
              invoke<unknown>("read_quiz_progress", { root: activeRoot, course }),
          })
          .catch(() => undefined),
      ]);
      if (!cancelled) {
        setPostFlushReady(true);
        setFlushDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [course, activeRoot, queryClient]);

  const queriesSettled =
    flushDone &&
    postFlushReady &&
    packQuery.isSuccess &&
    !packQuery.isFetching &&
    progressQuery.isSuccess &&
    !progressQuery.isFetching &&
    flushAt > 0 &&
    packQuery.dataUpdatedAt >= flushAt &&
    progressQuery.dataUpdatedAt >= flushAt;

  let parsedPack: QuizPack | null = null;
  let packLoadError = false;
  if (queriesSettled) {
    try {
      const parsed = parseQuizPack(packQuery.data);
      if (parsed.course !== course) {
        throw new Error("course mismatch");
      }
      parsedPack = parsed;
    } catch {
      packLoadError = true;
    }
  }

  const identity =
    parsedPack && activeRoot ? `${activeRoot}|${packIdentity(parsedPack)}` : null;

  useEffect(() => {
    if (!queriesSettled) {
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate session when pack identity settles */
    if (packLoadError) {
      setSessionIdentity("__error__");
      setPack(null);
      setReview(null);
      setProgress({});
      return;
    }
    if (!parsedPack || !identity || identity === sessionIdentity) {
      return;
    }
    let parsedProgress: QuizProgress;
    try {
      parsedProgress = parseQuizProgress(progressQuery.data);
    } catch {
      parsedProgress = {};
    }
    setSessionIdentity(identity);
    setPack(parsedPack);
    setProgress(parsedProgress);
    setReview(createReview(parsedPack));
    lastSyncedDataRef.current = {
      pack: packQuery.dataUpdatedAt,
      progress: progressQuery.dataUpdatedAt,
    };
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [
    queriesSettled,
    packLoadError,
    parsedPack,
    identity,
    sessionIdentity,
    progressQuery.data,
    packQuery.dataUpdatedAt,
    progressQuery.dataUpdatedAt,
  ]);

  useEffect(() => {
    if (!queriesSettled || !identity || identity !== sessionIdentity || !review) {
      return;
    }
    const packAt = packQuery.dataUpdatedAt;
    const progressAt = progressQuery.dataUpdatedAt;
    if (
      packAt === lastSyncedDataRef.current.pack &&
      progressAt === lastSyncedDataRef.current.progress
    ) {
      return;
    }
    lastSyncedDataRef.current = { pack: packAt, progress: progressAt };

    let syncedPack: QuizPack;
    try {
      syncedPack = parseQuizPack(packQuery.data);
      if (syncedPack.course !== course) {
        return;
      }
    } catch {
      return;
    }

    let syncedProgress = progress;
    try {
      syncedProgress = parseQuizProgress(progressQuery.data);
    } catch {
      /* keep optimistic local progress */
    }

    /* eslint-disable react-hooks/set-state-in-effect -- merge refreshed pack in place */
    setPack(syncedPack);
    setProgress(syncedProgress);
    setReview((prev) => {
      if (!prev) {
        return prev;
      }
      const currentId = prev.questions[prev.index]?.id;
      const questions = syncedPack.questions;
      let index = prev.index;
      if (currentId) {
        const found = questions.findIndex((q) => q.id === currentId);
        if (found >= 0) {
          index = found;
        }
      }
      if (questions.length === 0) {
        return prev;
      }
      const clampedIndex = Math.min(index, questions.length - 1);
      const question = questions[clampedIndex];
      const choice = prev.answers[question.id];
      return {
        questions,
        index: clampedIndex,
        selected: choice ?? prev.selected,
        submitted: choice !== undefined ? true : prev.submitted,
        answers: prev.answers,
      };
    });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [
    queriesSettled,
    identity,
    sessionIdentity,
    packQuery.data,
    packQuery.dataUpdatedAt,
    progressQuery.data,
    progressQuery.dataUpdatedAt,
    course,
    review,
    progress,
  ]);

  const citationsReport = (() => {
    if (!citationsQuery.isSuccess || citationsQuery.data == null) {
      return null;
    }
    try {
      return parseCitationsReport(citationsQuery.data);
    } catch {
      return null;
    }
  })();

  function handleSubmit() {
    if (!review || review.selected === null || !activeRoot || !pack) {
      return;
    }
    const question = currentQuestion(review);
    const wasSubmitted =
      review.submitted || review.answers[question.id] !== undefined;
    const choiceIndex = review.selected;
    const result = submitChoice(review, choiceIndex, progress);
    setReview(result.review);
    setProgress(result.progress);
    queryClient.setQueryData(qk.quizProgress(activeRoot, course), result.progress);
    if (!wasSubmitted && result.review.submitted) {
      const correct = choiceIndex === question.answer_index;
      enqueueWrite({
        key: `${course}:${question.id}:${Date.now()}`,
        root: activeRoot,
        course,
        args: {
          root: activeRoot,
          course,
          action: "quiz",
          id: question.id,
          result: correct ? "correct" : "wrong",
          digest: question.source.digest,
          heading: question.source.heading ?? "",
        },
      });
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || isDialogOpen()) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (!review || review.questions.length === 0) {
        return;
      }
      const choiceIndex = Number(event.key) - 1;
      if (choiceIndex >= 0 && choiceIndex <= 3 && !review.submitted) {
        event.preventDefault();
        setReview((r) => (r ? selectChoice(r, choiceIndex) : r));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (review.selected !== null && !review.submitted) {
          handleSubmit();
        } else {
          setReview((r) => (r ? nextReview(r) : r));
        }
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setReview((r) => (r ? previousReview(r) : r));
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setReview((r) => (r ? nextReview(r) : r));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function runQuizJob(force: boolean) {
    if (!activeRoot || viewerBlocked) {
      return;
    }
    const modelId = effective.modelId?.trim();
    if (!modelId) {
      setModelHint("Select a model in Settings.");
      return;
    }
    setModelHint(null);
    const providerLabel =
      PROVIDER_FALLBACK.find((p) => p.id === effective.providerId)?.label ??
      effective.providerId;
    try {
      const auth = await fetchAuthStatus(effective.providerId, true);
      if (!auth.authenticated) {
        appendLog(signedOutJobMessage(providerLabel, auth.reason));
        return;
      }
    } catch (error) {
      appendLog(signedOutJobMessage(providerLabel, String(error)));
      return;
    }
    try {
      const jobId = await startJob.mutateAsync({
        course,
        force,
        model: modelId,
        provider: effective.providerId,
      });
      appendLog(`Quiz job ${jobId} started.`);
    } catch (error) {
      appendLog(`Quiz generation failed to start: ${error}`);
    }
  }

  const hasPack = pack !== null && review !== null;
  const packUnavailable =
    packQuery.isError || (queriesSettled && packLoadError);
  const awaitingSettled =
    !flushDone ||
    !postFlushReady ||
    !packQuery.isSuccess ||
    packQuery.isFetching ||
    !progressQuery.isSuccess ||
    progressQuery.isFetching ||
    (flushAt > 0 && packQuery.dataUpdatedAt < flushAt) ||
    (flushAt > 0 && progressQuery.dataUpdatedAt < flushAt);
  const queriesLoading = awaitingSettled && !hasPack && !packUnavailable;
  const displayName = courseDisplayName(course);
  const jobDisabled = viewerBlocked || studyJobRunning || startJob.isPending;

  if (queriesLoading) {
    return (
      <StudyViewShell testId="quiz-view">
        <StudyColumn className="mx-auto flex w-full max-w-flashcards flex-col items-center gap-3.5">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="mt-6 h-80 w-full" />
        </StudyColumn>
      </StudyViewShell>
    );
  }

  if (!hasPack) {
    return (
      <StudyViewShell testId="quiz-view">
        <StudyColumn className="mx-auto flex w-full max-w-flashcards flex-col items-center gap-4">
          <EmptyState
            title="No quiz yet"
            description={`No quiz yet for ${displayName}. Generate questions from your digests.`}
            actions={
              <div className="flex flex-col items-center gap-2">
                {modelHint ? (
                  <p className="text-sm text-muted-foreground">{modelHint}</p>
                ) : null}
                <Button
                  disabled={jobDisabled}
                  title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
                  onClick={() => void runQuizJob(false)}
                >
                  Generate
                </Button>
              </div>
            }
          />
        </StudyColumn>
      </StudyViewShell>
    );
  }

  const session = review;
  const question = currentQuestion(session);
  const score = sessionScore(session);
  const progressRatio = (session.index + 1) / session.questions.length;
  const failedCitationIds = failedIdsFor(citationsReport, "study/quiz.json");
  const citationReason = citationsReport?.failures.find(
    (f) => f.path === "study/quiz.json" && f.id === question.id,
  )?.reason;

  return (
    <StudyViewShell testId="quiz-view">
      <StudyColumn>
        <div className="flex h-row w-full items-center gap-4">
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            Question {session.index + 1} of {session.questions.length}
          </span>
          <StudyProgressBar ratio={progressRatio} />
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            {score.correct} / {score.total} correct
          </span>
        </div>

        <StudyArtifactToolbar
          stale={Boolean(staleQuery.data)}
          viewerBlocked={viewerBlocked}
          jobDisabled={jobDisabled}
          onRefresh={() => void runQuizJob(true)}
          modelHint={modelHint}
        />

        <div
          data-testid="quiz-card"
          className="flex min-h-80 w-full flex-col rounded-md border border-border bg-card px-8 py-7 shadow-card"
        >
          <p className="font-serif text-flashcard-q">{question.prompt}</p>
          <div className="mt-6 flex flex-col gap-2">
            {question.choices.map((choice, index) => {
              const selected = session.selected === index;
              const showResult = session.submitted;
              const isCorrect = index === question.answer_index;
              const isWrongSelected = showResult && selected && !isCorrect;
              return (
                <Button
                  key={index}
                  type="button"
                  variant="outline"
                  size="lg"
                  disabled={session.submitted}
                  className={cn(
                    "h-auto w-full justify-between whitespace-normal py-3 text-left font-normal",
                    selected && !showResult && "border-primary ring-1 ring-primary",
                    showResult && isCorrect && "border-success text-success",
                    isWrongSelected && "border-destructive bg-destructive-surface text-destructive",
                  )}
                  onClick={() => setReview(selectChoice(session, index))}
                >
                  <span>{choice}</span>
                  <span className="inline-flex shrink-0 items-center gap-1.5">
                    {showResult && isCorrect ? (
                      <Check className="size-icon-sm" aria-hidden />
                    ) : null}
                    {isWrongSelected ? <X className="size-icon-sm" aria-hidden /> : null}
                    <Kbd>{index + 1}</Kbd>
                  </span>
                </Button>
              );
            })}
          </div>
          {session.submitted ? (
            <div className="mt-6 border-t border-dashed border-border pt-6">
              <p className="font-serif text-read text-muted-foreground">{question.explanation}</p>
            </div>
          ) : null}
          <div className="mt-auto flex min-w-0 flex-wrap items-center gap-2 pt-5 text-xs text-faint-foreground">
            <StudySourceChip course={course} source={question.source} digests={digests} />
            {failedCitationIds.has(question.id) ? (
              <StudyUnverifiedBadge reason={citationReason} />
            ) : null}
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setReview(previousReview(session))}
          >
            <ChevronLeft className="size-icon-sm" />
            Previous
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={session.selected === null || session.submitted}
            onClick={() => handleSubmit()}
          >
            Submit
          </Button>
          <Button type="button" variant="outline" onClick={() => setReview(nextReview(session))}>
            Next
            <ChevronRight className="size-icon-sm" />
          </Button>
        </div>
      </StudyColumn>
    </StudyViewShell>
  );
}

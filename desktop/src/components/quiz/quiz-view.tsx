import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { StudyEmpty } from "~/components/study/study-empty";
import { StudyArtifactToolbar } from "~/components/study/study-artifact-toolbar";
import { StudyColumn, StudyViewShell } from "~/components/study/study-layout";
import { StudyProgressBar } from "~/components/study/study-progress-bar";
import { StudySourceChip } from "~/components/study/study-source-chip";
import { answeredScore, scopedSessionKey, scopeItems, scopeNoun } from "~/components/study/study-scope";
import { useStudyScope } from "~/components/study/use-study-scope";
import { StudyUnverifiedBadge } from "~/components/study/study-unverified-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
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
  submitChoice,
} from "~/domain/quiz";
import { restoreQuiz, snapshotQuiz } from "~/domain/study-session";
import type { DigestInfo, QuizPack, QuizProgress, QuizReview } from "~/domain/types";
import { useStudyJobLauncher } from "~/hooks/use-study-job-launcher";
import { invoke } from "~/lib/ipc";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useStartQuizJobMutation } from "~/lib/queries/jobs";
import { qk } from "~/lib/queries/keys";
import { useSettings } from "~/lib/queries/settings";
import { useQuizProgress, useStudyArtifactStale, useStudyJson } from "~/lib/queries/study";
import { isDialogOpen, isEditableTarget } from "~/lib/shortcuts";
import { flushStudyWrites, useEnqueueStudyWrite } from "~/lib/study-writes";
import { useStudySessionStore } from "~/stores/study-session-store";
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
  const enqueueWrite = useEnqueueStudyWrite();
  const scope = useStudyScope(course);
  const startJob = useStartQuizJobMutation(activeRoot);
  const {
    viewerBlocked,
    viewerWriteReason,
    modelHint,
    jobDisabled,
    launchStudyJob,
  } = useStudyJobLauncher(activeRoot, {
    mutateAsync: startJob.mutateAsync,
    isPending: startJob.isPending,
    startedMessage: (jobId) => `Quiz job ${jobId} started.`,
    failedMessage: "Quiz generation failed to start",
  });

  const [flushDone, setFlushDone] = useState(false);
  const [postFlushReady, setPostFlushReady] = useState(false);
  const [flushAt, setFlushAt] = useState(0);
  const [pack, setPack] = useState<QuizPack | null>(null);
  const [progress, setProgress] = useState<QuizProgress>({});
  const [review, setReview] = useState<QuizReview | null>(null);
  const [sessionIdentity, setSessionIdentity] = useState<string | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const lastSyncedDataRef = useRef({ pack: 0, progress: 0 });
  const prevSessionIdentityRef = useRef<string | null>(null);

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

  const progressReady =
    (progressQuery.isSuccess || progressQuery.isError) && !progressQuery.isFetching;

  const queriesSettled =
    flushDone &&
    postFlushReady &&
    packQuery.isSuccess &&
    !packQuery.isFetching &&
    progressReady &&
    flushAt > 0 &&
    packQuery.dataUpdatedAt >= flushAt &&
    (progressQuery.isError || progressQuery.dataUpdatedAt >= flushAt);

  // The ticked lectures scope the pack; an empty scope is the whole class.
  const scoped = scope.digests.length > 0;
  const scopeOpts = scoped ? { digests: scope.digests } : undefined;
  const scopeRef = useRef<readonly string[]>([]);
  useEffect(() => {
    scopeRef.current = scope.digests;
  });

  let parsedPack: QuizPack | null = null;
  let packLoadError = false;
  if (queriesSettled) {
    try {
      const parsed = parseQuizPack(packQuery.data);
      if (parsed.course !== course) {
        throw new Error("course mismatch");
      }
      parsedPack = { ...parsed, questions: scopeItems(course, parsed.questions, scope.digests) };
    } catch {
      packLoadError = true;
    }
  }

  const identity =
    parsedPack && activeRoot ? `${activeRoot}|${packIdentity(parsedPack)}` : null;

  if (queriesSettled) {
    if (packLoadError) {
      if (sessionIdentity !== "__error__") {
        setSessionIdentity("__error__");
        setPack(null);
        setReview(null);
        setProgress({});
      }
    } else if (parsedPack && identity && identity !== sessionIdentity) {
      let parsedProgress: QuizProgress = {};
      if (progressQuery.isSuccess) {
        try {
          parsedProgress = parseQuizProgress(progressQuery.data);
        } catch {
          parsedProgress = {};
        }
      }
      let nextReview = createReview(parsedPack);
      if (activeRoot) {
        const key = scopedSessionKey(activeRoot, course, "quiz", scope.digests);
        const saved = useStudySessionStore.getState().sessions[key];
        const restored = restoreQuiz(saved, parsedPack, identity);
        if (restored) {
          nextReview = restored;
        }
      }
      setSessionIdentity(identity);
      setPack(parsedPack);
      setProgress(parsedProgress);
      setReview(nextReview);
    }
  }

  useLayoutEffect(() => {
    if (
      queriesSettled &&
      identity &&
      identity === sessionIdentity &&
      sessionIdentity !== "__error__" &&
      prevSessionIdentityRef.current !== sessionIdentity
    ) {
      lastSyncedDataRef.current = {
        pack: packQuery.dataUpdatedAt,
        progress: progressQuery.dataUpdatedAt,
      };
    }
    prevSessionIdentityRef.current = sessionIdentity;
  }, [
    queriesSettled,
    identity,
    sessionIdentity,
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
      syncedPack = { ...syncedPack, questions: scopeItems(course, syncedPack.questions, scopeRef.current) };
    } catch {
      return;
    }

    setPack(syncedPack);
    setReview((prev) => {
      if (!prev) {
        return prev;
      }
      const currentId = prev.questions[prev.index]?.id;
      const questions = syncedPack.questions;
      let index = prev.index;
      let idFound = true;
      if (currentId) {
        const found = questions.findIndex((q) => q.id === currentId);
        if (found >= 0) {
          index = found;
        } else {
          idFound = false;
        }
      }
      if (questions.length === 0) {
        return prev;
      }
      const clampedIndex = Math.min(index, questions.length - 1);
      const question = questions[clampedIndex];
      const choice = prev.answers[question.id];
      if (choice !== undefined) {
        return {
          questions,
          index: clampedIndex,
          selected: choice,
          submitted: true,
          answers: prev.answers,
        };
      }
      if (idFound && prev.submitted) {
        return {
          questions,
          index: clampedIndex,
          selected: prev.selected as number,
          submitted: true,
          answers: prev.answers,
        };
      }
      return {
        questions,
        index: clampedIndex,
        selected: idFound ? prev.selected : null,
        submitted: false,
        answers: prev.answers,
      };
    });
  }, [
    queriesSettled,
    identity,
    sessionIdentity,
    packQuery.data,
    packQuery.dataUpdatedAt,
    progressQuery.dataUpdatedAt,
    course,
    review,
  ]);

  useEffect(() => {
    if (!activeRoot || !identity || identity !== sessionIdentity || !review) {
      return;
    }
    if (review.questions.length === 0) {
      return;
    }
    const key = scopedSessionKey(activeRoot, course, "quiz", scope.digests);
    useStudySessionStore.getState().save(key, snapshotQuiz(review, identity));
  }, [activeRoot, course, identity, scope.digests, sessionIdentity, review]);

  function confirmRestart() {
    if (!pack || !activeRoot) {
      return;
    }
    const key = scopedSessionKey(activeRoot, course, "quiz", scope.digests);
    useStudySessionStore.getState().clear(key);
    setReview(createReview(pack));
    setRestartOpen(false);
  }

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

  const handleSubmit = useCallback(function handleSubmit() {
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
  }, [review, progress, pack, activeRoot, course, queryClient, enqueueWrite]);

  const reviewRef = useRef(review);
  const handleSubmitRef = useRef(handleSubmit);

  useLayoutEffect(() => {
    reviewRef.current = review;
    handleSubmitRef.current = handleSubmit;
  }, [review, handleSubmit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || isDialogOpen()) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const currentReview = reviewRef.current;
      if (!currentReview || currentReview.questions.length === 0) {
        return;
      }
      const choiceIndex = Number(event.key) - 1;
      if (choiceIndex >= 0 && choiceIndex <= 3 && !currentReview.submitted) {
        event.preventDefault();
        setReview((r) => (r ? selectChoice(r, choiceIndex) : r));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const r = reviewRef.current;
        if (r?.selected !== null && r?.selected !== undefined && !r.submitted) {
          handleSubmitRef.current();
        } else {
          setReview((prev) => (prev ? nextReview(prev) : prev));
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
  }, []);

  const hasPack = pack !== null && review !== null && !(scoped && pack.questions.length === 0);
  const packUnavailable =
    packQuery.isError || (queriesSettled && packLoadError);
  const awaitingSettled =
    !flushDone ||
    !postFlushReady ||
    !packQuery.isSuccess ||
    packQuery.isFetching ||
    !(progressQuery.isSuccess || progressQuery.isError) ||
    progressQuery.isFetching ||
    (flushAt > 0 && packQuery.dataUpdatedAt < flushAt) ||
    (flushAt > 0 &&
      !progressQuery.isError &&
      progressQuery.dataUpdatedAt < flushAt);
  const queriesLoading = awaitingSettled && !hasPack && !packUnavailable;
  const displayName = courseDisplayName(course);

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
          <StudyEmpty
            title="No quiz yet"
            description={
              scoped
                ? `No quiz yet for ${scopeNoun(scope.digests.length).these}. Generate questions from ${scopeNoun(scope.digests.length).their}.`
                : `No quiz yet for ${displayName}. Generate questions from your digests.`
            }
            modelHint={modelHint}
            disabled={jobDisabled}
            disabledReason={viewerBlocked ? viewerWriteReason : undefined}
            onGenerate={() => void launchStudyJob(course, false, scopeOpts)}
          />
        </StudyColumn>
      </StudyViewShell>
    );
  }

  const session = review;
  const question = currentQuestion(session);
  const score = answeredScore(session);
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
          onRefresh={() => void launchStudyJob(course, true)}
          modelHint={modelHint}
          trailing={
            <Button type="button" variant="ghost" size="xs" onClick={() => setRestartOpen(true)}>
              <RotateCcw className="size-icon-sm" />
              Restart
            </Button>
          }
        />

        <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
          <AlertDialogContent>
            <AlertDialogTitle>Restart this quiz?</AlertDialogTitle>
            <AlertDialogDescription>
              Your past answers stay in your stats; the quiz starts again from question 1.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmRestart}>
                Restart quiz
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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
                    "h-auto w-full justify-between whitespace-normal py-3 text-left font-normal disabled:opacity-100",
                    selected && !showResult && "border-primary ring-1 ring-primary",
                    showResult &&
                      isCorrect &&
                      "border-success bg-success-surface text-success",
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
            <div className="mt-6 border-t border-border pt-6">
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
            <ArrowLeft className="size-icon-sm" />
            Previous
          </Button>
          {session.submitted ? (
            <Button type="button" onClick={() => setReview(nextReview(session))}>
              Next question
            </Button>
          ) : (
            <Button type="button" disabled={session.selected === null} onClick={() => handleSubmit()}>
              Submit
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setReview(nextReview(session))}>
            Next
            <ArrowRight className="size-icon-sm" />
          </Button>
        </div>
      </StudyColumn>
    </StudyViewShell>
  );
}

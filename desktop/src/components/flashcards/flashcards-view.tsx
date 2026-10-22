import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RotateCcw, Shuffle } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { EmptyState } from "~/components/app/empty-state";
import { StudyArtifactToolbar } from "~/components/study/study-artifact-toolbar";
import { StudyColumn, StudyViewShell } from "~/components/study/study-layout";
import { StudyProgressBar } from "~/components/study/study-progress-bar";
import { StudySourceChip } from "~/components/study/study-source-chip";
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
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { courseDisplayName } from "~/domain/course";
import { failedIdsFor, parseCitationsReport } from "~/domain/citations";
import {
  advanceAfterGrade,
  applyGradeToDueIds,
  cardsForIds,
  createReview,
  currentCard,
  dropCurrentCard,
  flipReview,
  nextReview,
  parseFlashcardDeck,
  previousReview,
  requeueCurrentCard,
  shuffleCards,
  type FlashcardGrade,
} from "~/domain/flashcards";
import {
  intersectDueFlashcardSession,
  parseSavedFlashcards,
  restoreFlashcards,
  snapshotFlashcards,
  studySessionKey,
} from "~/domain/study-session";
import type { FlashcardDeck, FlashcardReview } from "~/domain/types";
import type { CourseOverviewPayload, DigestInfo } from "~/domain/types";
import { useStudyJobLauncher } from "~/hooks/use-study-job-launcher";
import { invoke } from "~/lib/ipc";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useStartFlashcardJobMutation } from "~/lib/queries/jobs";
import { useCourseOverview } from "~/lib/queries/notes";
import { qk } from "~/lib/queries/keys";
import { useSettings } from "~/lib/queries/settings";
import { useStudyArtifactStale, useStudyJson } from "~/lib/queries/study";
import { isDialogOpen, isEditableTarget } from "~/lib/shortcuts";
import { flushStudyWrites, useEnqueueStudyWrite } from "~/lib/study-writes";
import { useStudySessionStore } from "~/stores/study-session-store";
type DeckMode = "due" | "full";

function deckIdentity(deck: FlashcardDeck): string {
  return `${deck.course}:${deck.cards.map((c) => c.id).join("\0")}`;
}

function sessionForMode(
  deck: FlashcardDeck,
  mode: DeckMode,
  dueIds: readonly string[],
): FlashcardReview {
  if (mode === "full") {
    return createReview(deck);
  }
  return {
    cards: cardsForIds(deck, dueIds),
    index: 0,
    flipped: false,
  };
}

function sessionWithOptionalFocus(
  deck: FlashcardDeck,
  dueIds: readonly string[],
  focusCardId: string | undefined,
): { mode: DeckMode; review: FlashcardReview; clearFocusParam: boolean } {
  const mode: DeckMode = "due";
  let review = sessionForMode(deck, mode, dueIds);
  if (!focusCardId) {
    return { mode, review, clearFocusParam: false };
  }
  let index = review.cards.findIndex((c) => c.id === focusCardId);
  if (index >= 0) {
    review = { ...review, index, flipped: false };
    return { mode, review, clearFocusParam: true };
  }
  const fullReview = sessionForMode(deck, "full", dueIds);
  index = fullReview.cards.findIndex((c) => c.id === focusCardId);
  if (index >= 0) {
    return {
      mode: "full",
      review: { ...fullReview, index, flipped: false },
      clearFocusParam: true,
    };
  }
  return { mode, review, clearFocusParam: true };
}

export function FlashcardsView({
  course,
  digests,
  focusCardId,
  onFocusCardHandled,
}: {
  course: string;
  digests: DigestInfo[];
  focusCardId?: string;
  onFocusCardHandled: () => void;
}) {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const enqueueWrite = useEnqueueStudyWrite();
  const startJob = useStartFlashcardJobMutation(activeRoot);
  const {
    viewerBlocked,
    viewerWriteReason,
    modelHint,
    jobDisabled,
    launchStudyJob,
  } = useStudyJobLauncher(activeRoot, {
    mutateAsync: startJob.mutateAsync,
    isPending: startJob.isPending,
    startedMessage: (jobId) => `Flashcard job ${jobId} started.`,
    failedMessage: "Flashcard generation failed to start",
  });

  const [flushDone, setFlushDone] = useState(false);
  const [postFlushReady, setPostFlushReady] = useState(false);
  const [deckMode, setDeckMode] = useState<DeckMode>("due");
  const [dueIds, setDueIds] = useState<string[]>([]);
  const [deckCount, setDeckCount] = useState(0);
  const [review, setReview] = useState<FlashcardReview | null>(null);
  const [deck, setDeck] = useState<FlashcardDeck | null>(null);
  const [sessionIdentity, setSessionIdentity] = useState<string | null>(null);
  const [flushAt, setFlushAt] = useState(0);
  const [restartOpen, setRestartOpen] = useState(false);

  const focusClearPendingRef = useRef(false);
  const lastSyncedDataRef = useRef({ deck: 0, overview: 0 });
  const prevSessionIdentityRef = useRef<string | null>(null);

  const deckQuery = useStudyJson(activeRoot, course, "flashcards.json");
  const citationsQuery = useStudyJson(activeRoot, course, "citations.json");
  const staleQuery = useStudyArtifactStale(activeRoot, course, "flashcards");
  const overview = useCourseOverview(activeRoot, course, flushDone);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setFlushDone(false);
      setPostFlushReady(false);
      setFlushAt(0);
      setSessionIdentity(null);
      setDeck(null);
      setReview(null);
      await flushStudyWrites(3000);
      if (cancelled || !activeRoot) {
        return;
      }
      const flushedAt = Date.now();
      setFlushAt(flushedAt);
      const deckKey = qk.studyJson(activeRoot, course, "flashcards.json");
      const overviewKey = qk.courseOverview(activeRoot, course);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: overviewKey }),
        queryClient.invalidateQueries({ queryKey: deckKey }),
      ]);
      await Promise.all([
        queryClient.fetchQuery({
          queryKey: overviewKey,
          queryFn: () =>
            invoke<CourseOverviewPayload>("study_progress", {
              root: activeRoot,
              course,
              action: "overview",
            }),
        }),
        queryClient
          .fetchQuery({
            queryKey: deckKey,
            queryFn: () =>
              invoke<unknown>("read_study_json", {
                root: activeRoot,
                course,
                file: "flashcards.json",
              }),
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
    deckQuery.isSuccess &&
    !deckQuery.isFetching &&
    overview.isSuccess &&
    !overview.isFetching &&
    flushAt > 0 &&
    deckQuery.dataUpdatedAt >= flushAt &&
    overview.dataUpdatedAt >= flushAt;

  let parsedDeck: FlashcardDeck | null = null;
  let deckLoadError = false;
  if (queriesSettled) {
    try {
      const parsed = parseFlashcardDeck(deckQuery.data);
      if (parsed.course !== course) {
        throw new Error("course mismatch");
      }
      parsedDeck = parsed;
    } catch {
      deckLoadError = true;
    }
  }

  const identity =
    parsedDeck && activeRoot ? `${activeRoot}|${deckIdentity(parsedDeck)}` : null;

  if (queriesSettled) {
    if (deckLoadError) {
      if (sessionIdentity !== "__error__") {
        setSessionIdentity("__error__");
        setDeck(null);
        setReview(null);
      }
    } else if (parsedDeck && identity && identity !== sessionIdentity) {
      const dueFromOverview = [...overview.data!.due.due_ids];
      let nextMode: DeckMode;
      let nextReview: FlashcardReview;
      if (focusCardId) {
        const focused = sessionWithOptionalFocus(parsedDeck, dueFromOverview, focusCardId);
        nextMode = focused.mode;
        nextReview = focused.review;
      } else if (activeRoot) {
        const key = studySessionKey(activeRoot, course, "flashcards");
        const savedRaw = useStudySessionStore.getState().sessions[key];
        const parsedSaved = parseSavedFlashcards(savedRaw);
        let restored: ReturnType<typeof restoreFlashcards> = null;
        if (parsedSaved && parsedSaved.identity === identity) {
          let snapshot: typeof parsedSaved | null = parsedSaved;
          if (parsedSaved.deckMode === "due") {
            snapshot = intersectDueFlashcardSession(parsedSaved, dueFromOverview);
          }
          if (snapshot) {
            restored = restoreFlashcards(snapshot, parsedDeck, identity);
          }
        }
        if (restored) {
          nextMode = restored.deckMode;
          nextReview = restored.review;
        } else {
          const focused = sessionWithOptionalFocus(parsedDeck, dueFromOverview, undefined);
          nextMode = focused.mode;
          nextReview = focused.review;
        }
      } else {
        const focused = sessionWithOptionalFocus(parsedDeck, dueFromOverview, undefined);
        nextMode = focused.mode;
        nextReview = focused.review;
      }
      setSessionIdentity(identity);
      setDeck(parsedDeck);
      setDeckMode(nextMode);
      setDueIds(dueFromOverview);
      setDeckCount(overview.data!.due.deck_count);
      setReview(nextReview);
    }
  }

  useLayoutEffect(() => {
    if (
      queriesSettled &&
      !deckLoadError &&
      parsedDeck &&
      identity &&
      identity === sessionIdentity &&
      prevSessionIdentityRef.current !== sessionIdentity
    ) {
      const dueFromOverview = [...overview.data!.due.due_ids];
      const focused = sessionWithOptionalFocus(parsedDeck, dueFromOverview, focusCardId);
      if (focused.clearFocusParam) {
        focusClearPendingRef.current = true;
      }
      lastSyncedDataRef.current = {
        deck: deckQuery.dataUpdatedAt,
        overview: overview.dataUpdatedAt,
      };
    }
    prevSessionIdentityRef.current = sessionIdentity;
  }, [
    queriesSettled,
    deckLoadError,
    parsedDeck,
    identity,
    sessionIdentity,
    focusCardId,
    overview.data,
    deckQuery.dataUpdatedAt,
    overview.dataUpdatedAt,
  ]);

  useEffect(() => {
    if (!queriesSettled || !identity || identity !== sessionIdentity || !review) {
      return;
    }
    const deckAt = deckQuery.dataUpdatedAt;
    const overAt = overview.dataUpdatedAt;
    if (
      deckAt === lastSyncedDataRef.current.deck &&
      overAt === lastSyncedDataRef.current.overview
    ) {
      return;
    }
    lastSyncedDataRef.current = { deck: deckAt, overview: overAt };

    let syncedDeck: FlashcardDeck;
    try {
      syncedDeck = parseFlashcardDeck(deckQuery.data);
      if (syncedDeck.course !== course) {
        return;
      }
    } catch {
      return;
    }

    /* eslint-disable react-hooks/set-state-in-effect -- merge refreshed deck cards in place */
    setDeck(syncedDeck);
    setReview((prev) => {
      if (!prev) {
        return prev;
      }
      const byId = new Map(syncedDeck.cards.map((c) => [c.id, c]));
      const cards = [];
      for (const { id } of prev.cards) {
        const card = byId.get(id);
        if (card) {
          cards.push(card);
        }
      }
      if (cards.length === 0) {
        return { cards: [], index: 0, flipped: false };
      }
      const currentId = prev.cards[prev.index]?.id;
      let index = Math.min(prev.index, cards.length - 1);
      if (currentId) {
        const found = cards.findIndex((c) => c.id === currentId);
        if (found >= 0) {
          index = found;
        }
      }
      return { ...prev, cards, index };
    });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [
    queriesSettled,
    identity,
    sessionIdentity,
    deckQuery.data,
    deckQuery.dataUpdatedAt,
    overview.dataUpdatedAt,
    course,
    review,
  ]);

  useEffect(() => {
    if (!focusClearPendingRef.current) {
      return;
    }
    focusClearPendingRef.current = false;
    onFocusCardHandled();
  }, [review, onFocusCardHandled]);

  useEffect(() => {
    if (
      !activeRoot ||
      !identity ||
      identity !== sessionIdentity ||
      !review ||
      review.cards.length === 0
    ) {
      return;
    }
    const key = studySessionKey(activeRoot, course, "flashcards");
    useStudySessionStore
      .getState()
      .save(key, snapshotFlashcards(review, deckMode, identity));
  }, [activeRoot, course, identity, sessionIdentity, review, deckMode]);

  function confirmRestart() {
    if (!deck || !activeRoot) {
      return;
    }
    const key = studySessionKey(activeRoot, course, "flashcards");
    useStudySessionStore.getState().clear(key);
    setReview(sessionForMode(deck, deckMode, dueIds));
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

  const failedCitationIds = failedIdsFor(citationsReport, "study/flashcards.json");

  function switchDeckMode(mode: DeckMode) {
    if (!deck) {
      return;
    }
    setDeckMode(mode);
    setReview(sessionForMode(deck, mode, dueIds));
  }

  function gradeCard(grade: FlashcardGrade) {
    if (!review?.flipped || review.cards.length === 0 || !activeRoot || !deck) {
      return;
    }
    const card = currentCard(review);
    const nextDueIds = applyGradeToDueIds(dueIds, card.id, grade);
    setDueIds(nextDueIds);

    queryClient.setQueryData<CourseOverviewPayload>(
      qk.courseOverview(activeRoot, course),
      (old) => {
        if (!old) {
          return old;
        }
        const wasDue = old.due.due_ids.includes(card.id);
        const count =
          grade === "again" || !wasDue
            ? old.due.count
            : Math.max(0, old.due.count - 1);
        return {
          ...old,
          due: {
            ...old.due,
            due_ids: nextDueIds,
            count,
          },
        };
      },
    );

    if (deckMode === "due") {
      setReview(
        grade === "again" ? requeueCurrentCard(review) : dropCurrentCard(review),
      );
    } else {
      setReview(
        grade === "again" ? requeueCurrentCard(review) : advanceAfterGrade(review),
      );
    }

    enqueueWrite({
      key: `${course}:${card.id}:${Date.now()}`,
      root: activeRoot,
      course,
      args: {
        root: activeRoot,
        course,
        action: "grade",
        id: card.id,
        result: grade,
        digest: card.source.digest,
        heading: card.source.heading ?? "",
      },
    });
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || isDialogOpen()) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (!review || review.cards.length === 0) {
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        setReview((r) => (r ? flipReview(r) : r));
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
        return;
      }
      if (!review.flipped) {
        return;
      }
      const gradeMap: Record<string, FlashcardGrade> = {
        "1": "again",
        "2": "wrong",
        "3": "mastered",
      };
      const grade = gradeMap[event.key];
      if (grade) {
        event.preventDefault();
        gradeCard(grade);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const hasDeck = deck !== null && review !== null;
  const deckUnavailable =
    deckQuery.isError ||
    (queriesSettled && deckLoadError);
  const awaitingSettled =
    !flushDone ||
    !postFlushReady ||
    !deckQuery.isSuccess ||
    deckQuery.isFetching ||
    !overview.isSuccess ||
    overview.isFetching ||
    (flushAt > 0 && deckQuery.dataUpdatedAt < flushAt) ||
    (flushAt > 0 && overview.dataUpdatedAt < flushAt);
  const queriesLoading = awaitingSettled && !hasDeck && !deckUnavailable;
  const displayName = courseDisplayName(course);

  if (queriesLoading) {
    return (
      <StudyViewShell testId="flashcards-view">
        <StudyColumn className="mx-auto flex w-full max-w-flashcards flex-col items-center gap-3.5">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="mt-6 h-80 w-full" />
        </StudyColumn>
      </StudyViewShell>
    );
  }

  if (!hasDeck) {
    return (
      <StudyViewShell testId="flashcards-view">
        <StudyColumn className="mx-auto flex w-full max-w-flashcards flex-col items-center gap-4">
          <EmptyState
            title="No flashcards yet"
            description={`No flashcards yet for ${displayName}. Generate a deck from your digests.`}
            actions={
              <div className="flex flex-col items-center gap-2">
                {modelHint ? (
                  <p className="text-sm text-muted-foreground">{modelHint}</p>
                ) : null}
                <Button
                  disabled={jobDisabled}
                  title={viewerBlocked ? viewerWriteReason : undefined}
                  onClick={() => void launchStudyJob(course, false)}
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
  const emptySession = session.cards.length === 0;
  const progressRatio = emptySession
    ? 0
    : (session.index + 1) / session.cards.length;

  const card = emptySession ? null : currentCard(session);

  const citationReason =
    card && citationsReport
      ? citationsReport.failures.find(
          (f) => f.path === "study/flashcards.json" && f.id === card.id,
        )?.reason
      : undefined;

  return (
    <StudyViewShell testId="flashcards-view">
      <StudyColumn>
        <div className="flex h-row w-full items-center gap-4">
          <Tabs
            value={deckMode}
            onValueChange={(value) => switchDeckMode(value as DeckMode)}
            className="gap-0"
          >
            <TabsList variant="underline" className="h-row gap-4 border-b-0">
              <TabsTrigger value="due">Due today · {dueIds.length}</TabsTrigger>
              <TabsTrigger value="full">Full deck · {deckCount}</TabsTrigger>
            </TabsList>
          </Tabs>
          <StudyProgressBar ratio={progressRatio} />
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            {emptySession ? "0 / 0" : `${session.index + 1} / ${session.cards.length}`}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={() => setRestartOpen(true)}
          >
            <RotateCcw className="size-icon-sm" />
            Restart
          </Button>
        </div>

        <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
          <AlertDialogContent>
            <AlertDialogTitle>Restart this deck?</AlertDialogTitle>
            <AlertDialogDescription>
              Your grades are kept; only your place in the deck resets.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmRestart}>
                Restart deck
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <StudyArtifactToolbar
          stale={Boolean(staleQuery.data)}
          viewerBlocked={viewerBlocked}
          jobDisabled={jobDisabled}
          onRefresh={() => void launchStudyJob(course, true)}
          modelHint={modelHint}
        />

        {emptySession ? (
          <div className="flex min-h-80 w-full flex-col items-center justify-center gap-3 rounded-md border border-border bg-card p-8 shadow-card">
            <p className="text-sm text-muted-foreground">
              {deckMode === "due" ? "No cards due today." : "No cards in deck."}
            </p>
            {deckMode === "due" ? (
              <Button type="button" variant="link" onClick={() => switchDeckMode("full")}>
                Study full deck
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div
              data-testid="flashcard-card"
              className="flex min-h-80 w-full cursor-pointer flex-col rounded-md border border-border bg-card px-8 py-7 shadow-card"
              onClick={() => setReview(flipReview(session))}
            >
              <span className="font-serif text-sm italic text-faint-foreground">Question</span>
              <p className="mt-4.5 font-serif text-flashcard-q">{card!.front}</p>
              {session.flipped ? (
                <div className="mt-4.5 border-t border-dashed border-border pt-4.5">
                  <span className="font-serif text-sm italic text-faint-foreground">Answer</span>
                  <p className="mt-4.5 font-serif text-read text-muted-foreground">{card!.back}</p>
                </div>
              ) : null}
              <div className="mt-auto flex items-center justify-between gap-2 pt-5 text-xs text-faint-foreground">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <StudySourceChip
                    course={course}
                    source={card!.source}
                    digests={digests}
                    onClick={(event) => event.stopPropagation()}
                  />
                  {failedCitationIds.has(card!.id) ? (
                    <StudyUnverifiedBadge reason={citationReason} />
                  ) : null}
                  {card!.tags.length > 0 ? (
                    <span className="truncate">{card!.tags.join(" · ")}</span>
                  ) : null}
                </div>
                <span className="inline-flex shrink-0 items-center gap-1">
                  Click or press Space to flip <Kbd>Space</Kbd>
                </span>
              </div>
            </div>

            {session.flipped ? (
              <div className="grid w-full grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="justify-between"
                  onClick={() => gradeCard("again")}
                >
                  <span className="text-destructive">Again</span>
                  <Kbd>1</Kbd>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="justify-between"
                  onClick={() => gradeCard("wrong")}
                >
                  <span>Wrong</span>
                  <Kbd>2</Kbd>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="justify-between"
                  onClick={() => gradeCard("mastered")}
                >
                  <span className="text-success">Mastered</span>
                  <Kbd>3</Kbd>
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="lg"
                className="w-full"
                onClick={() => setReview(flipReview(session))}
              >
                Flip
              </Button>
            )}

            <div className="flex w-full flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setReview(previousReview(session))}
              >
                <ChevronLeft className="size-icon-sm" />
                Previous
              </Button>
              {session.flipped ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setReview(flipReview(session))}
                >
                  <RotateCcw className="size-icon-sm" />
                  Show front
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={() => setReview(nextReview(session))}>
                Next
                <ChevronRight className="size-icon-sm" />
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setReview({
                    ...session,
                    cards: shuffleCards(session.cards),
                    index: 0,
                    flipped: false,
                  })
                }
              >
                <Shuffle className="size-icon-sm" />
                Shuffle
              </Button>
            </div>
          </>
        )}
      </StudyColumn>
    </StudyViewShell>
  );
}

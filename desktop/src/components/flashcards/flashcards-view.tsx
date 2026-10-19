import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Shuffle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Chip } from "~/components/app/chip";
import { EmptyState } from "~/components/app/empty-state";
import { UnsavedBadge } from "~/components/app/unsaved-badge";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  LazyTooltip,
  LazyTooltipContent,
  LazyTooltipTrigger,
} from "~/components/ui/lazy-tooltip";
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
import type { FlashcardDeck, FlashcardReview } from "~/domain/types";
import { VIEWER_WRITE_REASON, viewerBlocksWrite } from "~/domain/library-role";
import { resolveDigestSlug } from "~/domain/notes";
import { PROVIDER_FALLBACK, signedOutJobMessage } from "~/domain/provider";
import type { CourseOverviewPayload, DigestInfo } from "~/domain/types";
import { fetchAuthStatus } from "~/lib/auth-refresh";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useEffectiveProvider } from "~/lib/queries/effective-provider";
import { useStartFlashcardJobMutation } from "~/lib/queries/jobs";
import { useLibrary } from "~/lib/queries/library";
import { useCourseOverview } from "~/lib/queries/notes";
import { qk } from "~/lib/queries/keys";
import { useSettings } from "~/lib/queries/settings";
import { useStudyArtifactStale, useStudyJson } from "~/lib/queries/study";
import { isDialogOpen, isEditableTarget } from "~/lib/shortcuts";
import { flushStudyWrites, useEnqueueStudyWrite } from "~/lib/study-writes";
import { useJobStore } from "~/stores/job-store";

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
): { mode: DeckMode; review: FlashcardReview; focused: boolean } {
  let mode: DeckMode = "due";
  let review = sessionForMode(deck, mode, dueIds);
  if (!focusCardId) {
    return { mode, review, focused: false };
  }
  let index = review.cards.findIndex((c) => c.id === focusCardId);
  if (index < 0) {
    mode = "full";
    review = sessionForMode(deck, mode, dueIds);
    index = review.cards.findIndex((c) => c.id === focusCardId);
  }
  if (index >= 0) {
    review = { ...review, index, flipped: false };
    return { mode, review, focused: true };
  }
  return { mode, review, focused: false };
}

function formatSourceLabel(card: ReturnType<typeof currentCard>): string {
  const parts = [card.source.digest];
  if (card.source.heading) {
    parts.push(card.source.heading);
  }
  if (card.source.page) {
    parts.push(`p. ${card.source.page}`);
  }
  return parts.join(" · ");
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
  const navigate = useNavigate();
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
  const startJob = useStartFlashcardJobMutation(activeRoot);

  const [flushDone, setFlushDone] = useState(false);
  const [deckMode, setDeckMode] = useState<DeckMode>("due");
  const [dueIds, setDueIds] = useState<string[]>([]);
  const [deckCount, setDeckCount] = useState(0);
  const [review, setReview] = useState<FlashcardReview | null>(null);
  const [deck, setDeck] = useState<FlashcardDeck | null>(null);
  const [modelHint, setModelHint] = useState<string | null>(null);

  const initKeyRef = useRef<string | null>(null);
  const focusClearPendingRef = useRef(false);

  const deckQuery = useStudyJson(activeRoot, course, "flashcards.json");
  const citationsQuery = useStudyJson(activeRoot, course, "citations.json");
  const staleQuery = useStudyArtifactStale(activeRoot, course, "flashcards");
  const overview = useCourseOverview(activeRoot, course, flushDone);

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
    if (!flushDone || !deckQuery.isSuccess || !overview.isSuccess) {
      return;
    }
    try {
      /* eslint-disable react-hooks/set-state-in-effect -- hydrate session once per deck identity */
      const parsed = parseFlashcardDeck(deckQuery.data);
      if (parsed.course !== course) {
        throw new Error("course mismatch");
      }
      const identity = `${activeRoot}|${deckIdentity(parsed)}`;
      const dueFromOverview = [...overview.data.due.due_ids];

      if (initKeyRef.current !== identity) {
        initKeyRef.current = identity;
        const focused = sessionWithOptionalFocus(parsed, dueFromOverview, focusCardId);
        if (focused.focused) {
          focusClearPendingRef.current = true;
        }
        setDeck(parsed);
        setDeckMode(focused.mode);
        setDueIds(dueFromOverview);
        setDeckCount(overview.data.due.deck_count);
        setReview(focused.review);
      }
    } catch {
      initKeyRef.current = null;
      setDeck(null);
      setReview(null);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [
    flushDone,
    deckQuery.isSuccess,
    deckQuery.data,
    overview.isSuccess,
    overview.data,
    course,
    activeRoot,
    focusCardId,
  ]);

  useEffect(() => {
    if (!focusClearPendingRef.current) {
      return;
    }
    focusClearPendingRef.current = false;
    onFocusCardHandled();
  }, [review, onFocusCardHandled]);

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
        return {
          ...old,
          due: {
            ...old.due,
            due_ids: nextDueIds,
            count: grade === "again" ? old.due.count : Math.max(0, old.due.count - 1),
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

  async function runFlashcardJob(force: boolean) {
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
      appendLog(`Flashcard job ${jobId} started.`);
    } catch (error) {
      appendLog(`Flashcard generation failed to start: ${error}`);
    }
  }

  const hasDeck = deck !== null && review !== null;
  const deckUnavailable =
    deckQuery.isError ||
    (flushDone && deckQuery.isSuccess && deck === null && !deckQuery.isFetching);
  const queriesLoading =
    !flushDone ||
    deckQuery.isLoading ||
    overview.isLoading ||
    (deckQuery.isFetching && !hasDeck && !deckUnavailable);
  const displayName = courseDisplayName(course);
  const jobDisabled = viewerBlocked || studyJobRunning || startJob.isPending;

  if (queriesLoading && !hasDeck && !deckUnavailable) {
    return (
      <div
        data-testid="flashcards-view"
        className="notes-reading-pane flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-8"
      >
        <Skeleton className="mx-auto h-8 w-full max-w-flashcards" />
        <Skeleton className="mx-auto mt-6 h-80 w-full max-w-flashcards" />
      </div>
    );
  }

  if (!hasDeck) {
    return (
      <div
        data-testid="flashcards-view"
        className="notes-reading-pane flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-8"
      >
        <div className="mx-auto flex w-full max-w-flashcards flex-col items-center gap-4">
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
                  title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
                  onClick={() => void runFlashcardJob(false)}
                >
                  Generate
                </Button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  const session = review;
  const emptySession = session.cards.length === 0;
  const progress =
    emptySession ? 0 : ((session.index + 1) / session.cards.length) * 100;
  const card = emptySession ? null : currentCard(session);

  const citationReason =
    card && citationsReport
      ? citationsReport.failures.find(
          (f) => f.path === "study/flashcards.json" && f.id === card.id,
        )?.reason
      : undefined;

  return (
    <div
      data-testid="flashcards-view"
      className="notes-reading-pane flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-8"
    >
      <div className="mx-auto flex w-full max-w-flashcards flex-col items-center gap-3.5">
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
          <div className="flex h-progress min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[flex-grow] duration-fast ease-out-soft"
              style={{ flexGrow: progress === 0 ? 0 : progress }}
            />
            <div style={{ flexGrow: progress === 0 ? 1 : 100 - progress }} />
          </div>
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            {emptySession ? "0 / 0" : `${session.index + 1} / ${session.cards.length}`}
          </span>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {staleQuery.data ? (
            <span className="inline-flex items-center gap-1 text-faint-foreground">
              <RefreshCw className="size-icon-sm" aria-hidden />
              Digests updated since last generation.
            </span>
          ) : null}
          <UnsavedBadge />
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={jobDisabled}
            title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
            onClick={() => void runFlashcardJob(true)}
          >
            <RefreshCw className="size-icon-sm" />
            Refresh from digests
          </Button>
          {modelHint ? <span>{modelHint}</span> : null}
        </div>

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
              className="flex min-h-80 w-full cursor-pointer flex-col rounded-md border border-border bg-card p-7 shadow-card"
              onClick={() => setReview(flipReview(session))}
            >
              <span className="font-serif text-sm italic text-faint-foreground">
                {session.flipped ? "Answer" : "Question"}
              </span>
              <p className="mt-3 font-serif text-flashcard-q">
                {card!.front}
              </p>
              {session.flipped ? (
                <p className="mt-4 border-t border-dashed border-border pt-4 font-serif text-read text-muted-foreground">
                  {card!.back}
                </p>
              ) : null}
              <div className="mt-auto flex items-center justify-between gap-2 pt-5 text-xs text-faint-foreground">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Chip
                    variant="plain"
                    onClick={(event) => {
                      event.stopPropagation();
                      const slug = resolveDigestSlug(card!.source.digest, digests);
                      void navigate({
                        to: "/course/$course/notes/$digest",
                        params: { course, digest: slug },
                        search: card!.source.heading
                          ? { heading: card!.source.heading }
                          : {},
                      });
                    }}
                  >
                    {formatSourceLabel(card!)}
                  </Chip>
                  {failedCitationIds.has(card!.id) ? (
                    <LazyTooltip>
                      <LazyTooltipTrigger
                        render={(tooltipProps) => (
                          <Badge variant="destructive" className="cursor-default" {...tooltipProps}>
                            Unverified
                          </Badge>
                        )}
                      />
                      <LazyTooltipContent>{citationReason ?? "Citation check failed"}</LazyTooltipContent>
                    </LazyTooltip>
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
              <Button type="button" variant="outline" onClick={() => setReview(nextReview(session))}>
                Next
                <ChevronRight className="size-icon-sm" />
              </Button>
              <Button
                type="button"
                variant="ghost"
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
      </div>
    </div>
  );
}

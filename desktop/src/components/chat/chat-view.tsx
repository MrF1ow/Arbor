import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  ComposerSlashSuggestions,
  filterSlashCommands,
  isSlashSuggestionOpen,
  slashSuggestionInsert,
} from "~/components/chat/composer-slash-suggestions";
import { ChatThreadsPanel, ChatThreadsPanelShowButton } from "~/components/chat/chat-threads-panel";
import { ChatTranscript } from "~/components/chat/chat-transcript";
import { LiveAnswer } from "~/components/chat/live-answer";
import { ModeChip } from "~/components/chat/mode-chip";
import { Button, IconButton } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import type { ChatMode } from "~/domain/chat";
import { isChatMode, parseSlashCommand, workerHistory } from "~/domain/chat";
import { useDictation } from "~/lib/dictation";
import { isMacPlatform } from "~/lib/shortcuts";
import { CourseIconDisplay } from "~/components/app/course-icon-display";
import { courseDisplayName, workspaceRootLabel } from "~/domain/course";
import { PROVIDER_FALLBACK } from "~/domain/provider";
import type { DigestInfo, KnowledgeRootEntry } from "~/domain/types";
import { useStudyJobLauncher } from "~/hooks/use-study-job-launcher";
import { sendChatMessage } from "~/lib/chat-runner";
import { useCourseMeta } from "~/lib/queries/course-meta";
import { useEffectiveProvider } from "~/lib/queries/effective-provider";
import {
  useChatThread,
  useChatThreads,
  useSetChatThreadMode,
} from "~/lib/queries/chat";
import { useStartFlashcardJobMutation, useStartQuizJobMutation } from "~/lib/queries/jobs";
import {
  chatLiveKey,
  clearChatLiveIfIdle,
  getChatLiveSnapshot,
  isChatLiveInFlight,
  subscribeChatLive,
  type ChatLiveStatusTone,
} from "~/stores/chat-live-store";
import { useChatDraftsStore } from "~/stores/chat-drafts-store";
import { useUiStore } from "~/stores/ui-store";
import { useJobStore } from "~/stores/job-store";
import { Loader2, Mic, Square } from "lucide-react";

type ArtifactKind = "flashcards" | "quiz";

const COMPOSER_SLASH_LISTBOX_ID = "chat-composer-slash-listbox";

const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = {
  flashcards: "Flashcards",
  quiz: "Quiz",
};

export function ChatView({
  activeRoot,
  course,
  courses,
  digests,
  roots,
  threadId,
  modeParam,
  promptParam,
  onSearchClear,
  onModeSearchClear,
  onCourseChange,
  onThreadChange,
  onNewChatNavigate,
  initialArtifactKind = "flashcards",
}: {
  activeRoot: string | null;
  course: string;
  courses: string[];
  digests: DigestInfo[];
  roots: KnowledgeRootEntry[];
  threadId: string | null;
  modeParam?: string;
  promptParam?: string;
  onSearchClear: () => void;
  onModeSearchClear: () => void;
  onCourseChange: (course: string) => void;
  onThreadChange: (nextThreadId: string, replace?: boolean) => void;
  onNewChatNavigate: () => void;
  initialArtifactKind?: ArtifactKind;
}) {
  const queryClient = useQueryClient();
  const courseMeta = useCourseMeta(activeRoot);
  const threadsQuery = useChatThreads(activeRoot, course);
  const threadQuery = useChatThread(activeRoot, course, threadId);
  const setThreadMode = useSetChatThreadMode(activeRoot, course);
  const effective = useEffectiveProvider(activeRoot);
  const appendLog = useJobStore((s) => s.append);
  const chatThreadsOpen = useUiStore((s) => s.chatThreadsOpen);
  const setChatThreadsOpen = useUiStore((s) => s.setChatThreadsOpen);

  const draftText = useChatDraftsStore((s) =>
    activeRoot ? (s.drafts[`${activeRoot}\0${course}\0${threadId ?? "new"}`] ?? "") : "",
  );
  const setDraft = useChatDraftsStore((s) => s.setDraft);
  const clearDraft = useChatDraftsStore((s) => s.clearDraft);
  const moveDraft = useChatDraftsStore((s) => s.moveDraft);

  const startFlashcards = useStartFlashcardJobMutation(activeRoot);
  const startQuiz = useStartQuizJobMutation(activeRoot);
  const flashcardLauncher = useStudyJobLauncher(activeRoot, {
    mutateAsync: startFlashcards.mutateAsync,
    isPending: startFlashcards.isPending,
    startedMessage: (jobId) => `Flashcard job ${jobId} started.`,
    failedMessage: "Flashcard generation failed to start",
  });
  const quizLauncher = useStudyJobLauncher(activeRoot, {
    mutateAsync: startQuiz.mutateAsync,
    isPending: startQuiz.isPending,
    startedMessage: (jobId) => `Quiz job ${jobId} started.`,
    failedMessage: "Quiz generation failed to start",
  });

  const [localNewMode, setLocalNewMode] = useState<ChatMode>(() =>
    isChatMode(modeParam) ? modeParam : "ask",
  );
  const [gateStatus, setGateStatus] = useState<{ text: string; tone: ChatLiveStatusTone }>({
    text: "",
    tone: "muted",
  });
  const [artifactKind, setArtifactKind] = useState<ArtifactKind>(initialArtifactKind);
  const [streamingThreadId, setStreamingThreadId] = useState<string | null>(null);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const onDictationDraft = useCallback(
    (text: string) => {
      if (activeRoot) {
        setDraft(activeRoot, course, threadId, text);
      }
    },
    [activeRoot, course, setDraft, threadId],
  );
  const onDictationApplyFinal = useCallback(
    (text: string, caret: number) => {
      if (activeRoot) {
        setDraft(activeRoot, course, threadId, text);
      }
      requestAnimationFrame(() => {
        const el = composerRef.current;
        if (!el) {
          return;
        }
        el.focus();
        el.setSelectionRange(caret, caret);
      });
    },
    [activeRoot, course, setDraft, threadId],
  );
  const dictation = useDictation({
    onDraft: onDictationDraft,
    onApplyFinal: onDictationApplyFinal,
  });
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;
  const stickToBottomRef = useRef(true);
  const forceScrollRef = useRef(false);
  const sendingRef = useRef(false);
  const autoSendPromptRef = useRef<string | null>(null);
  const sendMessageRef = useRef<(question: string, sendMode?: ChatMode) => Promise<void>>(
    async () => undefined,
  );

  const rootEntry = roots.find((r) => r.path === activeRoot);
  const rootLabel = rootEntry ? workspaceRootLabel(rootEntry, roots) : (activeRoot ?? "");
  const providerLabel =
    PROVIDER_FALLBACK.find((p) => p.id === effective.providerId)?.label ??
    effective.providerId ??
    "Provider";

  const threadMeta = threadsQuery.data?.find((entry) => entry.id === threadId);
  const mode: ChatMode = threadId && threadMeta ? threadMeta.mode : localNewMode;

  const liveThreadId = threadId ?? streamingThreadId;
  const liveKey =
    activeRoot && liveThreadId ? chatLiveKey(activeRoot, course, liveThreadId) : "";

  const inFlight = useSyncExternalStore(subscribeChatLive, () =>
    liveKey ? isChatLiveInFlight(liveKey) : false,
  );
  const liveStatusText = useSyncExternalStore(subscribeChatLive, () =>
    liveKey ? getChatLiveSnapshot(liveKey).statusText : "",
  );
  const liveStatusTone = useSyncExternalStore(subscribeChatLive, () =>
    liveKey ? getChatLiveSnapshot(liveKey).statusTone : "muted",
  );

  const statusText =
    !inFlight && gateStatus.text ? gateStatus.text : liveStatusText;
  const statusTone =
    !inFlight && gateStatus.text ? gateStatus.tone : liveStatusTone;

  const controlsDisabled = inFlight || dictation.dictationActive;
  const composerDisabled = inFlight;
  const composerLocked = dictation.dictationActive;
  const artifactLauncher =
    artifactKind === "quiz" ? quizLauncher : flashcardLauncher;
  const artifactJobDisabled = artifactLauncher.jobDisabled;
  const artifactModelHint = artifactLauncher.modelHint;

  const lines = threadId && threadQuery.isFetched ? (threadQuery.data ?? []) : [];

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- sync new-chat mode from URL */
    if (!threadId) {
      setLocalNewMode(isChatMode(modeParam) ? modeParam : "ask");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [threadId, modeParam]);

  useEffect(() => {
    return () => {
      if (liveKey) {
        clearChatLiveIfIdle(liveKey);
      }
    };
  }, [liveKey]);

  useEffect(() => {
    return () => {
      if (dictationRef.current.dictationActive) {
        dictationRef.current.cancel();
      }
    };
  }, []);

  useEffect(() => {
    if (dictationRef.current.dictationActive) {
      dictationRef.current.cancel();
    }
  }, [course, threadId]);

  const scrollTranscriptIfSticky = () => {
    if (!stickToBottomRef.current) {
      return;
    }
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const forceScroll = forceScrollRef.current;
    if (forceScroll) {
      forceScrollRef.current = false;
    } else {
      const selection = window.getSelection();
      if (
        selection &&
        !selection.isCollapsed &&
        selection.anchorNode &&
        el.contains(selection.anchorNode)
      ) {
        return;
      }
    }
    el.scrollTop = el.scrollHeight;
  };

  useLayoutEffect(() => {
    scrollTranscriptIfSticky();
  }, [threadQuery.data, liveThreadId]);

  const sendMessage = async (questionRaw: string, sendMode: ChatMode = mode) => {
    const question = questionRaw.trim();
    if (
      !question ||
      !activeRoot ||
      composerDisabled ||
      composerLocked ||
      sendingRef.current ||
      !effective.providerId
    ) {
      return;
    }
    const providerId = effective.providerId;
    const modelId = effective.modelId?.trim();
    if (!modelId) {
      setGateStatus({ text: "Select a model in Settings.", tone: "destructive" });
      return;
    }

    sendingRef.current = true;
    const rootAtSend = activeRoot;
    const courseAtSend = course;
    const threadAtSend = threadId;
    const historySnapshot = workerHistory(lines);

    try {
      setGateStatus({ text: "", tone: "muted" });
      const result = await sendChatMessage({
        queryClient,
        root: rootAtSend,
        course: courseAtSend,
        threadId: threadAtSend,
        mode: sendMode,
        question,
        providerId,
        providerLabel,
        modelId,
        history: historySnapshot,
        onAuthGate: (text, tone) => setGateStatus({ text, tone }),
        appendLog,
      });
      setStreamingThreadId(result.threadId);
      if (!threadAtSend) {
        moveDraft(rootAtSend, courseAtSend, null, result.threadId);
        onThreadChange(result.threadId, true);
      }
      clearDraft(rootAtSend, courseAtSend, threadAtSend);
      clearDraft(rootAtSend, courseAtSend, result.threadId);
      stickToBottomRef.current = true;
      forceScrollRef.current = true;
    } catch {
      // Status handled in runner or auth gate.
    } finally {
      sendingRef.current = false;
    }
  };

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  });

  useEffect(() => {
    const prompt = promptParam?.trim();
    if (!prompt || !activeRoot || !effective.providerId?.trim() || !effective.modelId?.trim()) {
      return;
    }
    if (threadId) {
      return;
    }
    if (autoSendPromptRef.current === prompt) {
      return;
    }
    autoSendPromptRef.current = prompt;
    const sendMode = isChatMode(modeParam) ? modeParam : "ask";
    setDraft(activeRoot, course, null, prompt);
    void sendMessageRef.current(prompt, sendMode).finally(() => {
      onSearchClear();
    });
  }, [
    promptParam,
    modeParam,
    activeRoot,
    threadId,
    course,
    onSearchClear,
    setDraft,
    effective.providerId,
    effective.modelId,
  ]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- clear stale stream id when idle */
    if (!inFlight) {
      setStreamingThreadId(null);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [inFlight, threadId]);

  const applyChatMode = (next: ChatMode) => {
    if (threadId && activeRoot) {
      void setThreadMode.mutateAsync({ thread: threadId, mode: next });
    } else {
      setLocalNewMode(next);
    }
    onModeSearchClear();
  };

  const toggleChatMode = () => {
    applyChatMode(mode === "ask" ? "explain" : "ask");
  };

  const slashPrefixActive = isSlashSuggestionOpen(draftText) && !slashDismissed;
  const slashOptions = slashPrefixActive ? filterSlashCommands(draftText) : [];
  const slashListOpen = slashOptions.length > 0;

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reset slash highlight when filter changes */
    setSlashActiveIndex(0);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [draftText]);

  const submitComposer = async (raw: string) => {
    const parsed = parseSlashCommand(raw);
    if (parsed.mode) {
      applyChatMode(parsed.mode);
    }
    const question = parsed.text.trim();
    if (!question) {
      if (activeRoot) {
        setDraft(activeRoot, course, threadId, "");
      }
      return;
    }
    await sendMessage(question, parsed.mode ?? mode);
  };

  const pickSlashSuggestion = (index: number) => {
    const entry = slashOptions[index];
    if (!entry || !activeRoot) {
      return;
    }
    setDraft(activeRoot, course, threadId, slashSuggestionInsert(entry.command));
    setSlashActiveIndex(0);
    composerRef.current?.focus();
  };

  const onComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composerLocked && event.key === "Escape") {
      event.preventDefault();
      dictation.cancel();
      return;
    }
    if (composerLocked && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      return;
    }

    if (event.key === "Tab" && event.shiftKey) {
      if (event.nativeEvent.isComposing || event.keyCode === 229) {
        return;
      }
      event.preventDefault();
      toggleChatMode();
      return;
    }

    if (slashListOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashActiveIndex((prev) => (prev + 1) % slashOptions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashActiveIndex((prev) => (prev - 1 + slashOptions.length) % slashOptions.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashDismissed(true);
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        if (event.nativeEvent.isComposing || event.keyCode === 229) {
          return;
        }
        event.preventDefault();
        pickSlashSuggestion(slashActiveIndex);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      if (event.nativeEvent.isComposing || event.keyCode === 229) {
        return;
      }
      event.preventDefault();
      void submitComposer(draftText);
    }
  };

  const onDictationClick = () => {
    if (dictation.phase === "listening") {
      dictation.stop();
      return;
    }
    if (dictation.phase !== "idle") {
      return;
    }
    composerRef.current?.focus();
    const el = composerRef.current;
    const base = {
      text: draftText,
      selectionStart: el?.selectionStart ?? draftText.length,
      selectionEnd: el?.selectionEnd ?? draftText.length,
    };
    void dictation.start(base);
  };

  const dictationMicLabel =
    dictation.phase === "listening"
      ? "Stop dictation"
      : dictation.phase === "starting" || dictation.phase === "stopping"
        ? "Dictation"
        : "Dictate";
  const DictationIcon =
    dictation.phase === "listening"
      ? Square
      : dictation.phase === "starting" || dictation.phase === "stopping"
        ? Loader2
        : Mic;
  const dictationButtonClass =
    dictation.phase === "starting" || dictation.phase === "stopping"
      ? "[&_svg]:animate-spin"
      : undefined;

  const composerPlaceholder =
    mode === "explain"
      ? "Ask for a step-by-step explanation…"
      : "Ask about this course…";

  const slashActiveDescendant = slashListOpen
    ? `${COMPOSER_SLASH_LISTBOX_ID}-option-${slashOptions[slashActiveIndex]?.id ?? slashOptions[0]!.id}`
    : undefined;

  const onTranscriptScroll = () => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const onGenerateArtifact = () => {
    if (artifactKind === "quiz") {
      flashcardLauncher.clearModelHint();
    } else {
      quizLauncher.clearModelHint();
    }
    void artifactLauncher.launchStudyJob(course, false);
  };

  const statusClass =
    statusTone === "destructive" ? "text-destructive" : "text-muted-foreground";

  return (
    <div
      data-testid="chat-view"
      className="flex h-full min-h-0 flex-1 overflow-hidden"
    >
      {activeRoot && chatThreadsOpen ? (
        <ChatThreadsPanel
          root={activeRoot}
          course={course}
          activeThreadId={threadId}
          onSelectThread={(id) => onThreadChange(id)}
          onNewChat={onNewChatNavigate}
        />
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!chatThreadsOpen && activeRoot ? (
          <div className="shrink-0 border-b border-border px-2 py-2">
            <ChatThreadsPanelShowButton onClick={() => setChatThreadsOpen(true)} />
          </div>
        ) : null}
        <div className="shrink-0 border-b border-border px-8 py-3">
          <div className="mx-auto flex w-full max-w-reading flex-wrap items-center gap-2">
            <Select
              value={course}
              items={courses.map((slug) => ({ value: slug, label: courseDisplayName(slug) }))}
              disabled={controlsDisabled}
              onValueChange={(value) => {
                if (value) {
                  onCourseChange(value);
                }
              }}
            >
              <SelectTrigger className="w-48" aria-label="Course" title={rootLabel}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {courses.map((slug) => (
                  <SelectItem key={slug} value={slug}>
                    <span className="flex items-center gap-2">
                      <CourseIconDisplay meta={courseMeta.data} course={slug} />
                      {courseDisplayName(slug)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-8 py-6"
          data-testid="chat-transcript-scroll"
          onScroll={onTranscriptScroll}
        >
          <div className="mx-auto w-full max-w-reading">
            <ChatTranscript course={course} lines={lines} digests={digests} />
            {activeRoot && liveThreadId ? (
              <LiveAnswer
                root={activeRoot}
                course={course}
                threadId={liveThreadId}
                onContentChange={scrollTranscriptIfSticky}
              />
            ) : null}
          </div>
        </div>

        <div className="shrink-0 border-t border-border px-8 py-4">
          <div className="mx-auto flex w-full max-w-reading flex-col gap-3">
            <p className={`min-h-4 text-xs ${statusClass}`} data-testid="chat-status">
              {statusText}
            </p>
            <div className="relative flex flex-col gap-2">
              {slashListOpen ? (
                <ComposerSlashSuggestions
                  draftPrefix={draftText}
                  activeIndex={slashActiveIndex}
                  listboxId={COMPOSER_SLASH_LISTBOX_ID}
                  onPick={pickSlashSuggestion}
                />
              ) : null}
              <Textarea
                ref={composerRef}
                value={draftText}
                disabled={composerDisabled}
                readOnly={composerLocked}
                placeholder={composerPlaceholder}
                rows={1}
                className="max-h-36 min-h-10 w-full"
                onChange={(event) => {
                  setSlashDismissed(false);
                  if (activeRoot) {
                    setDraft(activeRoot, course, threadId, event.target.value);
                  }
                }}
                onKeyDown={onComposerKeyDown}
                aria-label="Chat message"
                aria-activedescendant={slashActiveDescendant}
                aria-controls={slashListOpen ? COMPOSER_SLASH_LISTBOX_ID : undefined}
                aria-expanded={slashListOpen ? true : undefined}
                aria-autocomplete={slashListOpen ? "list" : undefined}
                role={slashListOpen ? "combobox" : undefined}
              />
              <div className="flex items-center justify-between gap-2">
                <ModeChip mode={mode} disabled={controlsDisabled} onToggle={toggleChatMode} />
                <div className="flex items-center gap-2">
                  {isMacPlatform() ? (
                    <div className="flex items-center gap-1.5">
                      {dictation.phase === "listening" && dictation.elapsedLabel ? (
                        <>
                          <span
                            className="size-2 animate-pulse rounded-full bg-destructive"
                            aria-hidden
                          />
                          <span className="tabular-nums text-xs text-muted-foreground">
                            {dictation.elapsedLabel}
                          </span>
                        </>
                      ) : null}
                      <IconButton
                        icon={DictationIcon}
                        label={dictationMicLabel}
                        size="icon-sm"
                        className={dictationButtonClass}
                        variant={dictation.phase === "listening" ? "destructive-outline" : "ghost"}
                        disabled={
                          composerDisabled ||
                          dictation.phase === "starting" ||
                          dictation.phase === "stopping"
                        }
                        onClick={onDictationClick}
                      />
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    disabled={
                      composerDisabled || composerLocked || draftText.trim().length === 0
                    }
                    onClick={() => void submitComposer(draftText)}
                  >
                    Send
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Select
                value={artifactKind}
                items={(
                  Object.entries(ARTIFACT_KIND_LABEL) as [ArtifactKind, string][]
                ).map(([value, label]) => ({ value, label }))}
                disabled={artifactJobDisabled}
                onValueChange={(value) => {
                  if (value === "flashcards" || value === "quiz") {
                    setArtifactKind(value);
                  }
                }}
              >
                <SelectTrigger className="w-36" aria-label="Study artifact type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flashcards">Flashcards</SelectItem>
                  <SelectItem value="quiz">Quiz</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={artifactJobDisabled}
                title={
                  artifactLauncher.viewerBlocked ? artifactLauncher.viewerWriteReason : undefined
                }
                onClick={onGenerateArtifact}
              >
                Generate study artifact
              </Button>
              {artifactModelHint ? <span>{artifactModelHint}</span> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { Channel } from "@tauri-apps/api/core";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { ChatTranscript } from "~/components/chat/chat-transcript";
import { LiveAnswer } from "~/components/chat/live-answer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { ChatLine, ChatMode } from "~/domain/chat";
import {
  buildAssistantLine,
  buildSessionLine,
  buildUserLine,
  chatAuthErrorMessage,
  isChatMode,
  phaseLabel,
  workerHistory,
} from "~/domain/chat";
import { courseDisplayName, workspaceRootLabel } from "~/domain/course";
import { PROVIDER_FALLBACK, signedOutJobMessage } from "~/domain/provider";
import type { DigestInfo, KnowledgeRootEntry } from "~/domain/types";
import { useStudyJobLauncher } from "~/hooks/use-study-job-launcher";
import { fetchAuthStatus } from "~/lib/auth-refresh";
import { useEffectiveProvider } from "~/lib/queries/effective-provider";
import {
  useAppendChatLinesMutation,
  useChatHistory,
  useClearChatHistoryMutation,
  useStartChatMutation,
} from "~/lib/queries/chat";
import { useStartFlashcardJobMutation, useStartQuizJobMutation } from "~/lib/queries/jobs";
import {
  appendChatLiveDelta,
  beginChatLiveStream,
  chatLiveKey,
  clearChatLiveIfIdle,
  clearChatLiveText,
  finishChatLiveStream,
  getChatLiveSnapshot,
  isChatLiveInFlight,
  setChatLiveStatus,
  subscribeChatLive,
  type ChatLiveStatusTone,
} from "~/stores/chat-live-store";
import { useJobStore } from "~/stores/job-store";

type ArtifactKind = "flashcards" | "quiz";

const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = {
  flashcards: "Flashcards",
  quiz: "Quiz",
};

function linesSignature(rows: ChatLine[]): string {
  if (rows.length === 0) {
    return "";
  }
  const last = rows[rows.length - 1];
  return `${rows.length}:${last?.ts ?? ""}:${last?.role ?? ""}:${last?.content ?? ""}`;
}

export function ChatView({
  activeRoot,
  course,
  courses,
  digests,
  roots,
  modeParam,
  promptParam,
  onSearchClear,
  onModeSearchClear,
  onCourseChange,
  initialArtifactKind = "flashcards",
}: {
  activeRoot: string | null;
  course: string;
  courses: string[];
  digests: DigestInfo[];
  roots: KnowledgeRootEntry[];
  modeParam?: string;
  promptParam?: string;
  onSearchClear: () => void;
  onModeSearchClear: () => void;
  onCourseChange: (course: string) => void;
  initialArtifactKind?: ArtifactKind;
}) {
  const historyQuery = useChatHistory(activeRoot, course);
  const appendLines = useAppendChatLinesMutation(activeRoot, course);
  const clearHistory = useClearChatHistoryMutation(activeRoot, course);
  const startChat = useStartChatMutation(activeRoot, course);
  const effective = useEffectiveProvider(activeRoot);
  const appendLog = useJobStore((s) => s.append);

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

  const [mode, setMode] = useState<ChatMode>(() =>
    isChatMode(modeParam) ? modeParam : "ask",
  );
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [gateStatus, setGateStatus] = useState<{ text: string; tone: ChatLiveStatusTone }>({
    text: "",
    tone: "muted",
  });
  const [artifactKind, setArtifactKind] = useState<ArtifactKind>(initialArtifactKind);
  const [clearOpen, setClearOpen] = useState(false);

  const linesRef = useRef<ChatLine[]>(lines);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const forceScrollRef = useRef(false);
  const prevViewKeyRef = useRef("");
  const historyBlockRef = useRef(0);
  const adoptedSigRef = useRef("");
  const wasLiveInFlightRef = useRef(false);
  const autoSendPromptRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  const channelRef = useRef<Channel<unknown> | null>(null);
  const lastAuthReasonRef = useRef("");
  const sendMessageRef = useRef<(question: string, sendMode?: ChatMode) => Promise<void>>(
    async () => undefined,
  );

  const rootEntry = roots.find((r) => r.path === activeRoot);
  const rootLabel = rootEntry ? workspaceRootLabel(rootEntry, roots) : (activeRoot ?? "");
  const providerLabel =
    PROVIDER_FALLBACK.find((p) => p.id === effective.providerId)?.label ??
    effective.providerId ??
    "Provider";
  const liveKey = activeRoot ? chatLiveKey(activeRoot, course) : "";

  const inFlight = useSyncExternalStore(subscribeChatLive, () =>
    liveKey ? isChatLiveInFlight(liveKey) : false,
  );
  const liveStatusText = useSyncExternalStore(subscribeChatLive, () =>
    liveKey ? getChatLiveSnapshot(liveKey).statusText : "",
  );
  const liveStatusTone = useSyncExternalStore(subscribeChatLive, () =>
    liveKey ? getChatLiveSnapshot(liveKey).statusTone : "muted",
  );

  const statusText = inFlight || liveStatusText ? liveStatusText : gateStatus.text;
  const statusTone = inFlight || liveStatusText ? liveStatusTone : gateStatus.tone;

  const controlsDisabled = inFlight;
  const artifactLauncher =
    artifactKind === "quiz" ? quizLauncher : flashcardLauncher;
  const artifactJobDisabled = artifactLauncher.jobDisabled;
  const artifactModelHint = artifactLauncher.modelHint;

  const viewKey = `${activeRoot ?? ""}|${course}`;

  useEffect(() => {
    if (wasLiveInFlightRef.current && !inFlight && historyBlockRef.current === 0) {
      adoptedSigRef.current = "";
    }
    wasLiveInFlightRef.current = inFlight;
  }, [inFlight]);

  useLayoutEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- adopt server history on course/root change and refetch */
    if (prevViewKeyRef.current !== viewKey) {
      prevViewKeyRef.current = viewKey;
      historyBlockRef.current = 0;
      adoptedSigRef.current = "";
      if (historyQuery.isFetched && activeRoot) {
        const serverLines = historyQuery.data ?? [];
        adoptedSigRef.current = linesSignature(serverLines);
        linesRef.current = serverLines;
        setLines(serverLines);
      } else {
        linesRef.current = [];
        setLines([]);
      }
      return;
    }
    if (!activeRoot || !historyQuery.isFetched) {
      return;
    }
    if (historyBlockRef.current > 0) {
      return;
    }
    if (liveKey && getChatLiveSnapshot(liveKey).inFlight) {
      return;
    }
    const serverLines = historyQuery.data ?? [];
    const serverSig = linesSignature(serverLines);
    if (adoptedSigRef.current === serverSig) {
      return;
    }
    adoptedSigRef.current = serverSig;
    linesRef.current = serverLines;
    setLines(serverLines);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [activeRoot, course, historyQuery.data, historyQuery.isFetched, liveKey, viewKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (liveKey) {
        clearChatLiveIfIdle(liveKey);
      }
    };
  }, [liveKey]);

  const scrollTranscriptIfSticky = useCallback(() => {
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
  }, []);

  useLayoutEffect(() => {
    scrollTranscriptIfSticky();
  }, [lines, scrollTranscriptIfSticky]);

  const setStatusOnCourse = (
    courseAtSend: string,
    text: string,
    tone: ChatLiveStatusTone,
    key: string,
  ) => {
    if (course === courseAtSend && mountedRef.current) {
      setGateStatus({ text: "", tone: "muted" });
    }
    setChatLiveStatus(key, text, tone);
  };

  const sendMessage = async (questionRaw: string, sendMode: ChatMode = mode) => {
    const question = questionRaw.trim();
    if (!question || !activeRoot || inFlight || sendingRef.current || !effective.providerId) {
      return;
    }
    const providerId = effective.providerId;

    sendingRef.current = true;
    const courseAtSend = course;
    const rootAtSend = activeRoot;
    const streamKey = chatLiveKey(rootAtSend, courseAtSend);

    try {
      let auth;
      try {
        auth = await fetchAuthStatus(providerId, true);
        lastAuthReasonRef.current = auth.reason ?? "";
      } catch (error) {
        const message = signedOutJobMessage(providerLabel, String(error));
        setGateStatus({ text: message, tone: "destructive" });
        return;
      }

      if (!auth.authenticated) {
        const message = signedOutJobMessage(providerLabel, auth.reason ?? "");
        setGateStatus({ text: message, tone: "destructive" });
        return;
      }

      const modelId = effective.modelId?.trim();
      if (!modelId) {
        setGateStatus({ text: "Select a model in Settings.", tone: "destructive" });
        return;
      }

      historyBlockRef.current += 1;

      beginChatLiveStream(streamKey);
      setChatLiveStatus(streamKey, "Retrieving", "muted");
      setGateStatus({ text: "", tone: "muted" });

      const historySnapshot = workerHistory(linesRef.current);
      const userLine = buildUserLine(sendMode, question);
      let pendingAppend: Promise<void> = Promise.resolve();

      try {
        await appendLines.mutateAsync([userLine]);
        linesRef.current = [...linesRef.current, userLine];
        stickToBottomRef.current = true;
        forceScrollRef.current = true;
        if (course === courseAtSend && mountedRef.current) {
          setLines(linesRef.current);
          setInput("");
        }

        const channel = new Channel<unknown>();
        channelRef.current = channel;
        channel.onmessage = (raw) => {
          const event =
            raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
          const type = typeof event.type === "string" ? event.type : "";
          if (type === "chat_retrieved") {
            const label = phaseLabel("chat_retrieved") ?? "Answering";
            setStatusOnCourse(courseAtSend, label, "muted", streamKey);
            return;
          }
          if (type === "chat_delta") {
            if (courseAtSend !== course || rootAtSend !== activeRoot) {
              return;
            }
            const delta = typeof event.delta === "string" ? event.delta : "";
            appendChatLiveDelta(streamKey, delta);
            return;
          }
          if (type === "chat_done") {
            clearChatLiveText(streamKey);
            const markdown = typeof event.markdown === "string" ? event.markdown : "";
            const supported = event.supported === true;
            const citations = Array.isArray(event.citations)
              ? (event.citations as ChatLine["citations"])
              : [];
            const doneLabel = phaseLabel("chat_done") ?? "Done";
            setStatusOnCourse(courseAtSend, doneLabel, "muted", streamKey);
            const assistantLine = buildAssistantLine(
              sendMode,
              markdown,
              supported,
              citations ?? [],
            );
            pendingAppend = appendLines
              .mutateAsync([assistantLine])
              .then(() => {
                linesRef.current = [...linesRef.current, assistantLine];
                if (course === courseAtSend && mountedRef.current) {
                  setLines(linesRef.current);
                }
              })
              .catch((error) => {
                throw error;
              });
            void pendingAppend.catch(() => undefined);
            return;
          }
          if (type === "auth_failed") {
            const reason =
              typeof event.reason === "string"
                ? event.reason
                : lastAuthReasonRef.current;
            setStatusOnCourse(
              courseAtSend,
              signedOutJobMessage(providerLabel, reason),
              "destructive",
              streamKey,
            );
            return;
          }
          if (type === "error") {
            const message =
              typeof event.message === "string" ? event.message : "Chat failed.";
            setStatusOnCourse(courseAtSend, message, "destructive", streamKey);
            return;
          }
          if (type === "worker_exit") {
            void pendingAppend
              .catch((error) => {
                appendLog(`Could not append chat lines: ${error}`);
                setStatusOnCourse(
                  courseAtSend,
                  chatAuthErrorMessage(providerLabel, error),
                  "destructive",
                  streamKey,
                );
              })
              .finally(() => {
                finishChatLiveStream(streamKey);
                historyBlockRef.current = 0;
                adoptedSigRef.current = "";
                channelRef.current = null;
              });
          }
        };

        await startChat.mutateAsync({
          onEvent: channel,
          question,
          mode: sendMode,
          provider: providerId,
          model: modelId,
          history: historySnapshot,
        });
      } catch (error) {
        finishChatLiveStream(streamKey);
        historyBlockRef.current = 0;
        setStatusOnCourse(
          courseAtSend,
          chatAuthErrorMessage(providerLabel, error),
          "destructive",
          streamKey,
        );
      }
    } finally {
      sendingRef.current = false;
    }
  };

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  });

  useEffect(() => {
    const prompt = promptParam?.trim();
    if (!prompt || !activeRoot || !historyQuery.isFetched) {
      return;
    }
    if (autoSendPromptRef.current === prompt) {
      return;
    }
    autoSendPromptRef.current = prompt;
    const sendMode = isChatMode(modeParam) ? modeParam : "ask";
    setInput(prompt);
    onSearchClear();
    void sendMessageRef.current(prompt, sendMode);
  }, [promptParam, modeParam, activeRoot, historyQuery.isFetched, onSearchClear]);

  const onNewChat = async () => {
    if (!activeRoot || inFlight) {
      return;
    }
    const sessionLine = buildSessionLine();
    await appendLines.mutateAsync([sessionLine]);
    linesRef.current = [...linesRef.current, sessionLine];
    setLines(linesRef.current);
    setGateStatus({ text: "", tone: "muted" });
    if (liveKey) {
      setChatLiveStatus(liveKey, "", "muted");
    }
  };

  const onClearHistory = async () => {
    if (!activeRoot || inFlight) {
      return;
    }
    await clearHistory.mutateAsync();
    linesRef.current = [];
    setLines([]);
    adoptedSigRef.current = "";
    setGateStatus({ text: "", tone: "muted" });
    if (liveKey) {
      setChatLiveStatus(liveKey, "", "muted");
    }
    setClearOpen(false);
  };

  const onGenerateArtifact = () => {
    if (artifactKind === "quiz") {
      flashcardLauncher.clearModelHint();
    } else {
      quizLauncher.clearModelHint();
    }
    void artifactLauncher.launchStudyJob(course, false);
  };

  const onComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      if (event.nativeEvent.isComposing || event.keyCode === 229) {
        return;
      }
      event.preventDefault();
      void sendMessage(input);
    }
  };

  const onTranscriptScroll = () => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const statusClass =
    statusTone === "destructive" ? "text-destructive" : "text-muted-foreground";

  return (
    <div
      data-testid="chat-view"
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
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
                {courseDisplayName(slug)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup
          value={[mode]}
          disabled={controlsDisabled}
          onValueChange={(values) => {
            const next = values.length > 0 ? values[values.length - 1] : undefined;
            if (isChatMode(next)) {
              setMode(next);
              onModeSearchClear();
            }
          }}
        >
          <ToggleGroupItem value="ask" aria-label="Ask mode">
            Ask
          </ToggleGroupItem>
          <ToggleGroupItem value="explain" aria-label="Explain mode">
            Explain
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={controlsDisabled}
            onClick={() => void onNewChat()}
          >
            <MessageSquarePlus className="size-icon-sm" aria-hidden />
            New chat
          </Button>
          <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
            <AlertDialogTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={controlsDisabled}
                />
              }
            >
              <Trash2 className="size-icon-sm" aria-hidden />
              Clear history
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Clear history</AlertDialogTitle>
              <AlertDialogDescription>
                Delete all chat history for {course}? This cannot be undone.
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void onClearHistory()}>
                  Clear history
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
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
          {activeRoot ? (
            <LiveAnswer
              root={activeRoot}
              course={course}
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
          <div className="flex gap-2">
            <Textarea
              value={input}
              disabled={inFlight}
              placeholder="Ask about this course…"
              rows={1}
              className="max-h-36 min-h-10 flex-1"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onComposerKeyDown}
              aria-label="Chat message"
            />
            <Button
              type="button"
              disabled={inFlight || input.trim().length === 0}
              onClick={() => void sendMessage(input)}
            >
              Send
            </Button>
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
  );
}

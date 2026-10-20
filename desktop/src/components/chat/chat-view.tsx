import { Channel } from "@tauri-apps/api/core";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  chatLiveKey,
  clearChatLive,
} from "~/stores/chat-live-store";
import { useJobStore } from "~/stores/job-store";

type ArtifactKind = "flashcards" | "quiz";

export function ChatView({
  activeRoot,
  course,
  courses,
  digests,
  roots,
  modeParam,
  promptParam,
  onSearchClear,
  onCourseChange,
}: {
  activeRoot: string | null;
  course: string;
  courses: string[];
  digests: DigestInfo[];
  roots: KnowledgeRootEntry[];
  modeParam?: string;
  promptParam?: string;
  onSearchClear: () => void;
  onCourseChange: (course: string) => void;
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

  const [mode, setMode] = useState<ChatMode>(
    isChatMode(modeParam) ? modeParam : "ask",
  );
  const activeMode = isChatMode(modeParam) ? modeParam : mode;
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const [artifactKind, setArtifactKind] = useState<ArtifactKind>("flashcards");
  const [clearOpen, setClearOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const adoptedHistoryKey = useRef("");
  const autoSendPromptRef = useRef<string | null>(null);
  const sendMessageRef = useRef<(question: string, sendMode?: ChatMode) => Promise<void>>(
    async () => undefined,
  );

  const rootEntry = roots.find((r) => r.path === activeRoot);
  const rootLabel = rootEntry ? workspaceRootLabel(rootEntry, roots) : (activeRoot ?? "");
  const providerLabel =
    PROVIDER_FALLBACK.find((p) => p.id === effective.providerId)?.label ?? effective.providerId;
  const liveKey = activeRoot ? chatLiveKey(activeRoot, course) : "";

  const controlsDisabled = inFlight;
  const artifactLauncher =
    artifactKind === "quiz" ? quizLauncher : flashcardLauncher;
  const artifactJobDisabled = artifactLauncher.jobDisabled;
  const artifactModelHint = artifactLauncher.modelHint;

  useEffect(() => {
    const key = `${activeRoot ?? ""}|${course}`;
    if (adoptedHistoryKey.current === key) {
      return;
    }
    if (!historyQuery.data) {
      return;
    }
    adoptedHistoryKey.current = key;
    /* eslint-disable react-hooks/set-state-in-effect -- adopt server history once per root/course */
    setLines(historyQuery.data);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [historyQuery.data, activeRoot, course]);

  useEffect(() => {
    return () => {
      if (liveKey) {
        clearChatLive(liveKey);
      }
    };
  }, [liveKey]);

  useEffect(() => {
    if (lines.length === 0) {
      return;
    }
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines.length, status]);

  const sendMessage = async (questionRaw: string, sendMode: ChatMode = activeMode) => {
    const question = questionRaw.trim();
    if (!question || !activeRoot || inFlight) {
      return;
    }

    const courseAtSend = course;
    const rootAtSend = activeRoot;

    try {
      const auth = await fetchAuthStatus(effective.providerId, true);
      if (!auth.authenticated) {
        setStatus(signedOutJobMessage(providerLabel, auth.reason ?? ""));
        return;
      }
    } catch (error) {
      setStatus(signedOutJobMessage(providerLabel, String(error)));
      return;
    }

    const modelId = effective.modelId?.trim();
    if (!modelId) {
      setStatus("Select a model in Settings.");
      return;
    }

    setStatus("Retrieving");
    setInFlight(true);

    const historySnapshot = workerHistory(lines);
    const userLine = buildUserLine(sendMode, question);
    let pendingAppend: Promise<void> = Promise.resolve();

    try {
      await appendLines.mutateAsync([userLine]);
      if (course === courseAtSend) {
        setLines((prev) => [...prev, userLine]);
        setInput("");
      }

      const channel = new Channel<unknown>();
      channel.onmessage = (raw) => {
        const event =
          raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
        const type = typeof event.type === "string" ? event.type : "";
        if (type === "chat_retrieved") {
          if (course === courseAtSend) {
            setStatus("Answering");
          }
          return;
        }
        if (type === "chat_delta") {
          if (course !== courseAtSend || rootAtSend !== activeRoot) {
            return;
          }
          const delta = typeof event.delta === "string" ? event.delta : "";
          appendChatLiveDelta(chatLiveKey(rootAtSend, courseAtSend), delta);
          const el = scrollRef.current;
          if (el) {
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            if (atBottom) {
              el.scrollTop = el.scrollHeight;
            }
          }
          return;
        }
        if (type === "chat_done") {
          clearChatLive(chatLiveKey(rootAtSend, courseAtSend));
          const markdown = typeof event.markdown === "string" ? event.markdown : "";
          const supported = event.supported === true;
          const citations = Array.isArray(event.citations)
            ? (event.citations as ChatLine["citations"])
            : [];
          pendingAppend = (async () => {
            const assistantLine = buildAssistantLine(
              sendMode,
              markdown,
              supported,
              citations ?? [],
            );
            await appendLines.mutateAsync([assistantLine]);
            if (course === courseAtSend) {
              setLines((prev) => [...prev, assistantLine]);
              setStatus("Done");
            }
          })();
          return;
        }
        if (type === "auth_failed") {
          const reason =
            typeof event.reason === "string" ? event.reason : "";
          if (course === courseAtSend) {
            setStatus(signedOutJobMessage(providerLabel, reason));
          }
          return;
        }
        if (type === "error") {
          if (course === courseAtSend) {
            setStatus(typeof event.message === "string" ? event.message : "Chat failed.");
          }
          return;
        }
        if (type === "worker_exit") {
          void pendingAppend
            .catch((error) => {
              appendLog(`Could not append chat lines: ${error}`);
              if (course === courseAtSend) {
                setStatus(chatAuthErrorMessage(providerLabel, error));
              }
            })
            .finally(() => {
              clearChatLive(chatLiveKey(rootAtSend, courseAtSend));
              setInFlight(false);
            });
        }
      };

      await startChat.mutateAsync({
        onEvent: channel,
        question,
        mode: sendMode,
        provider: effective.providerId,
        model: modelId,
        history: historySnapshot,
      });
    } catch (error) {
      setInFlight(false);
      clearChatLive(chatLiveKey(rootAtSend, courseAtSend));
      setStatus(chatAuthErrorMessage(providerLabel, error));
    }
  };

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  });

  useEffect(() => {
    const prompt = promptParam?.trim();
    if (!prompt || !activeRoot) {
      return;
    }
    if (autoSendPromptRef.current === prompt) {
      return;
    }
    autoSendPromptRef.current = prompt;
    const sendMode = isChatMode(modeParam) ? modeParam : mode;
    setInput(prompt);
    onSearchClear();
    void sendMessageRef.current(prompt, sendMode);
  }, [promptParam, modeParam, activeRoot, mode, onSearchClear]);

  const onNewChat = async () => {
    if (!activeRoot || inFlight) {
      return;
    }
    const sessionLine = buildSessionLine();
    await appendLines.mutateAsync([sessionLine]);
    setLines((prev) => [...prev, sessionLine]);
    setStatus("");
  };

  const onClearHistory = async () => {
    if (!activeRoot || inFlight) {
      return;
    }
    await clearHistory.mutateAsync();
    setLines([]);
    setStatus("");
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
      event.preventDefault();
      void sendMessage(input);
    }
  };

  const statusClass =
    status.includes("not authenticated") || status.includes("failed")
      ? "text-destructive"
      : "text-muted-foreground";

  return (
    <div
      data-testid="chat-view"
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-8 py-3">
        <Select
          value={course}
          disabled={controlsDisabled}
          onValueChange={(value) => {
            if (value) {
              onCourseChange(value);
            }
          }}
        >
          <SelectTrigger className="w-48" aria-label="Course">
            <SelectValue>{courseDisplayName(course)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {courses.map((slug) => (
              <SelectItem key={slug} value={slug}>
                {courseDisplayName(slug)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-faint-foreground">{rootLabel}</span>
        <ToggleGroup
          value={[activeMode]}
          disabled={controlsDisabled}
          onValueChange={(values) => {
            const next = values.length > 0 ? values[values.length - 1] : undefined;
            if (isChatMode(next)) {
              setMode(next);
            }
          }}
        >
          <ToggleGroupItem value="ask" aria-label="Ask mode">
            Ask
          </ToggleGroupItem>
          <ToggleGroupItem value="explain" aria-label="Explain mode">
            Explain
          </ToggleGroupItem>
          <ToggleGroupItem value="quiz" aria-label="Quiz mode">
            Quiz
          </ToggleGroupItem>
        </ToggleGroup>
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
              Delete all chat history for {courseDisplayName(course)}? This cannot be undone.
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

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-8 py-6"
        data-testid="chat-transcript-scroll"
      >
        <div className="mx-auto w-full max-w-reading">
          <ChatTranscript course={course} lines={lines} digests={digests} />
          {activeRoot ? <LiveAnswer root={activeRoot} course={course} /> : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-8 py-4">
        <div className="mx-auto flex w-full max-w-reading flex-col gap-3">
          <p className={`min-h-4 text-xs ${statusClass}`} data-testid="chat-status">
            {status}
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

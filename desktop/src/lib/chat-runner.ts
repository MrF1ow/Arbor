import { Channel } from "@tauri-apps/api/core";
import type { QueryClient } from "@tanstack/react-query";

import type { ChatLine, ChatMode } from "~/domain/chat";
import {
  buildAssistantLine,
  buildUserLine,
  chatAuthErrorMessage,
  workerHistory,
} from "~/domain/chat";
import { signedOutJobMessage } from "~/domain/provider";
import { fetchAuthStatus } from "~/lib/auth-refresh";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";
import type { ChatThreadMeta } from "~/lib/queries/chat";
import {
  appendChatLiveDelta,
  beginChatLiveStream,
  chatLiveKey,
  clearChatLiveText,
  finishChatLiveStream,
  setChatLiveStatus,
  type ChatLiveStatusTone,
} from "~/stores/chat-live-store";

export type SendChatMessageOpts = {
  queryClient: QueryClient;
  root: string;
  course: string;
  threadId: string | null;
  mode: ChatMode;
  question: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  history: Array<{ role: string; content: string }>;
  onAuthGate?: (message: string, tone: ChatLiveStatusTone) => void;
  appendLog?: (line: string) => void;
};

export async function sendChatMessage(opts: SendChatMessageOpts): Promise<{ threadId: string }> {
  const {
    queryClient,
    root,
    course,
    mode,
    question,
    providerId,
    providerLabel,
    modelId,
    history,
    onAuthGate,
    appendLog,
  } = opts;
  let threadId = opts.threadId;

  let auth;
  try {
    auth = await fetchAuthStatus(providerId, true);
  } catch (error) {
    const message = signedOutJobMessage(providerLabel, String(error));
    onAuthGate?.(message, "destructive");
    throw new Error(message, { cause: error });
  }

  if (!auth.authenticated) {
    const message = signedOutJobMessage(providerLabel, auth.reason ?? "");
    onAuthGate?.(message, "destructive");
    throw new Error(message);
  }

  const trimmedModel = modelId.trim();
  if (!trimmedModel) {
    const message = "Select a model in Settings.";
    onAuthGate?.(message, "destructive");
    throw new Error(message);
  }

  if (!threadId) {
    const created = await invoke<ChatThreadMeta>("create_chat_thread", {
      root,
      course,
      mode,
    });
    threadId = created.id;
  }
  if (!threadId) {
    throw new Error("Could not create chat thread");
  }

  const streamKey = chatLiveKey(root, course, threadId);
  beginChatLiveStream(streamKey);
  setChatLiveStatus(streamKey, "Retrieving", "muted");

  const userLine = buildUserLine(mode, question);
  await invoke<ChatThreadMeta>("append_chat_thread_lines", {
    root,
    course,
    thread: threadId,
    lines: [userLine],
  });
  void queryClient.invalidateQueries({ queryKey: qk.chatThreads(root, course) });
  void queryClient.invalidateQueries({ queryKey: qk.chatThread(root, course, threadId) });

  const lastAuthReason = auth.reason ?? "";
  let pendingAppend: Promise<void> = Promise.resolve();

  const channel = new Channel<unknown>();
  channel.onmessage = (raw) => {
    const event = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const type = typeof event.type === "string" ? event.type : "";
    if (type === "chat_retrieved") {
      setChatLiveStatus(streamKey, "Answering", "muted");
      return;
    }
    if (type === "chat_delta") {
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
      setChatLiveStatus(streamKey, "Done", "muted");
      const assistantLine = buildAssistantLine(mode, markdown, supported, citations ?? []);
      pendingAppend = invoke<ChatThreadMeta>("append_chat_thread_lines", {
        root,
        course,
        thread: threadId!,
        lines: [assistantLine],
      })
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: qk.chatThreads(root, course) });
          void queryClient.invalidateQueries({
            queryKey: qk.chatThread(root, course, threadId!),
          });
        })
        .catch((error) => {
          throw error;
        });
      void pendingAppend.catch(() => undefined);
      return;
    }
    if (type === "auth_failed") {
      const reason =
        typeof event.reason === "string" ? event.reason : lastAuthReason;
      setChatLiveStatus(
        streamKey,
        signedOutJobMessage(providerLabel, reason),
        "destructive",
      );
      return;
    }
    if (type === "error") {
      const message = typeof event.message === "string" ? event.message : "Chat failed.";
      setChatLiveStatus(streamKey, message, "destructive");
      return;
    }
    if (type === "worker_exit") {
      void pendingAppend
        .catch((error) => {
          appendLog?.(`Could not append chat lines: ${error}`);
          setChatLiveStatus(
            streamKey,
            chatAuthErrorMessage(providerLabel, error),
            "destructive",
          );
        })
        .finally(() => {
          finishChatLiveStream(streamKey);
        });
    }
  };

  void invoke("start_chat", {
    root,
    course,
    onEvent: channel,
    question,
    mode,
    provider: providerId,
    model: trimmedModel,
    history,
  }).catch((error) => {
    finishChatLiveStream(streamKey);
    setChatLiveStatus(streamKey, chatAuthErrorMessage(providerLabel, error), "destructive");
  });

  return { threadId };
}

export function snapshotWorkerHistory(lines: ChatLine[]): Array<{ role: string; content: string }> {
  return workerHistory(lines);
}

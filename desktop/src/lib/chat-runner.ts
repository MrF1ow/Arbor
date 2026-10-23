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

function patchThreadCaches(
  queryClient: QueryClient,
  root: string,
  course: string,
  threadId: string,
  appendedLines: ChatLine[],
  meta: ChatThreadMeta,
) {
  queryClient.setQueryData<ChatLine[]>(qk.chatThread(root, course, threadId), (prev) => [
    ...(prev ?? []),
    ...appendedLines,
  ]);
  queryClient.setQueryData<ChatThreadMeta[]>(qk.chatThreads(root, course), (prev) => {
    const rows = prev ?? [];
    const index = rows.findIndex((entry) => entry.id === threadId);
    if (index < 0) {
      return [...rows, meta];
    }
    const next = rows.slice();
    next[index] = meta;
    return next;
  });
  void queryClient.invalidateQueries({ queryKey: qk.chatThreads(root, course) });
  void queryClient.invalidateQueries({ queryKey: qk.chatThread(root, course, threadId) });
}

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

  let createdThisSend = false;
  if (!threadId) {
    const created = await invoke<ChatThreadMeta>("create_chat_thread", {
      root,
      course,
      mode,
    });
    threadId = created.id;
    createdThisSend = true;
  }
  if (!threadId) {
    throw new Error("Could not create chat thread");
  }

  const streamKey = chatLiveKey(root, course, threadId);
  beginChatLiveStream(streamKey);
  setChatLiveStatus(streamKey, "Retrieving", "muted");

  const userLine = buildUserLine(mode, question);
  let userLineStored = false;
  try {
    const userMeta = await invoke<ChatThreadMeta>("append_chat_thread_lines", {
      root,
      course,
      thread: threadId,
      lines: [userLine],
    });
    userLineStored = true;
    patchThreadCaches(queryClient, root, course, threadId, [userLine], userMeta);
  } catch (error) {
    finishChatLiveStream(streamKey);
    const message = chatAuthErrorMessage(providerLabel, error);
    setChatLiveStatus(streamKey, message, "destructive");
    onAuthGate?.(message, "destructive");
    if (createdThisSend && !userLineStored) {
      await invoke("delete_chat_thread", { root, course, thread: threadId }).catch(() => undefined);
    }
    throw error;
  }

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
      }).then((meta) => {
        patchThreadCaches(queryClient, root, course, threadId!, [assistantLine], meta);
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
    const message = chatAuthErrorMessage(providerLabel, error);
    setChatLiveStatus(streamKey, message, "destructive");
    onAuthGate?.(message, "destructive");
  });

  return { threadId };
}

export function snapshotWorkerHistory(lines: ChatLine[]): Array<{ role: string; content: string }> {
  return workerHistory(lines);
}

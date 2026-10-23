import type { Channel } from "@tauri-apps/api/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ChatLine, ChatMode } from "~/domain/chat";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

export type ChatThreadMeta = {
  id: string;
  title: string;
  mode: ChatMode;
  created_at: string;
  updated_at: string;
};

export function useChatThreads(root: string | null, course: string | null) {
  return useQuery({
    queryKey: qk.chatThreads(root ?? "", course ?? ""),
    enabled: Boolean(root && course),
    queryFn: () =>
      invoke<ChatThreadMeta[]>("list_chat_threads", { root: root!, course: course! }),
  });
}

export function useChatThread(
  root: string | null,
  course: string | null,
  threadId: string | null,
) {
  return useQuery({
    queryKey: qk.chatThread(root ?? "", course ?? "", threadId ?? ""),
    enabled: Boolean(root && course && threadId),
    queryFn: () =>
      invoke<ChatLine[]>("read_chat_thread", {
        root: root!,
        course: course!,
        thread: threadId!,
      }),
  });
}

export type StartChatInput = {
  onEvent: Channel<unknown>;
  question: string;
  mode: string;
  model: string;
  provider?: string;
  history: unknown[];
};

export function useStartChatMutation(root: string | null, course: string | null) {
  return useMutation({
    mutationFn: (input: StartChatInput) =>
      invoke("start_chat", { root: root!, course: course!, ...input }),
  });
}

export function useRenameChatThread(root: string | null, course: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ thread, title }: { thread: string; title: string }) =>
      invoke<ChatThreadMeta>("rename_chat_thread", {
        root: root!,
        course: course!,
        thread,
        title,
      }),
    onSuccess: () => {
      if (root && course) {
        void queryClient.invalidateQueries({ queryKey: qk.chatThreads(root, course) });
      }
    },
  });
}

export function useDeleteChatThread(root: string | null, course: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (thread: string) =>
      invoke("delete_chat_thread", { root: root!, course: course!, thread }),
    onSuccess: (_data, thread) => {
      if (root && course) {
        void queryClient.invalidateQueries({ queryKey: qk.chatThreads(root, course) });
        void queryClient.invalidateQueries({ queryKey: qk.chatThread(root, course, thread) });
      }
    },
  });
}

export function useDeleteAllChatThreads(root: string | null, course: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke("delete_all_chat_threads", { root: root!, course: course! }),
    onSuccess: () => {
      if (root && course) {
        void queryClient.invalidateQueries({ queryKey: qk.chatThreads(root, course) });
      }
    },
  });
}

export function useSetChatThreadMode(root: string | null, course: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ thread, mode }: { thread: string; mode: ChatMode }) =>
      invoke<ChatThreadMeta>("set_chat_thread_mode", {
        root: root!,
        course: course!,
        thread,
        mode,
      }),
    onSuccess: (_data, { thread }) => {
      if (root && course) {
        void queryClient.invalidateQueries({ queryKey: qk.chatThreads(root, course) });
        void queryClient.invalidateQueries({ queryKey: qk.chatThread(root, course, thread) });
      }
    },
  });
}

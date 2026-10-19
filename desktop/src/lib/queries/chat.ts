import type { Channel } from "@tauri-apps/api/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ChatLine } from "~/domain/chat";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

export function useChatHistory(root: string | null, course: string | null) {
  return useQuery({
    queryKey: qk.chatHistory(root ?? "", course ?? ""),
    enabled: Boolean(root && course),
    queryFn: () =>
      invoke<ChatLine[]>("read_chat_history", { root: root!, course: course! }),
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

export function useAppendChatLinesMutation(root: string | null, course: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lines: ChatLine[]) =>
      invoke("append_chat_lines", { root: root!, course: course!, lines }),
    onSuccess: () => {
      if (root && course) {
        void queryClient.invalidateQueries({ queryKey: qk.chatHistory(root, course) });
      }
    },
  });
}

export function useClearChatHistoryMutation(root: string | null, course: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke("clear_chat_history", { root: root!, course: course! }),
    onSuccess: () => {
      if (root && course) {
        void queryClient.invalidateQueries({ queryKey: qk.chatHistory(root, course) });
      }
    },
  });
}

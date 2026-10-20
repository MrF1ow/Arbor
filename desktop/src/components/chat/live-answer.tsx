import { useSyncExternalStore } from "react";

import {
  chatLiveKey,
  getChatLiveText,
  subscribeChatLive,
} from "~/stores/chat-live-store";

export function LiveAnswer({ root, course }: { root: string; course: string }) {
  const key = chatLiveKey(root, course);
  const text = useSyncExternalStore(subscribeChatLive, () => getChatLiveText(key));

  if (!text) {
    return null;
  }

  return (
    <div className="mb-4 text-sm text-foreground" data-testid="chat-live-answer">
      <span>{text}</span>
      <span
        className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-muted-foreground align-middle"
        aria-hidden
      />
    </div>
  );
}

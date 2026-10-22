import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { renderAnswerHtml } from "~/domain/chat";
import {
  chatLiveKey,
  getChatLiveText,
  subscribeChatLive,
} from "~/stores/chat-live-store";

export function LiveAnswer({
  root,
  course,
  threadId,
  onContentChange,
}: {
  root: string;
  course: string;
  threadId: string;
  onContentChange?: () => void;
}) {
  const key = chatLiveKey(root, course, threadId);
  const textFromStore = useSyncExternalStore(subscribeChatLive, () => getChatLiveText(key));
  const [displayText, setDisplayText] = useState(textFromStore);
  const rafRef = useRef<number | null>(null);

  if (textFromStore === "" || !textFromStore.startsWith(displayText)) {
    if (displayText !== textFromStore) {
      setDisplayText(textFromStore);
    }
  }

  useEffect(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [key]);

  useEffect(() => {
    if (textFromStore === displayText) {
      return;
    }
    if (textFromStore === "" || !textFromStore.startsWith(displayText)) {
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setDisplayText(textFromStore);
    });
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [textFromStore, displayText]);

  useEffect(() => {
    onContentChange?.();
  }, [displayText, onContentChange]);

  if (!textFromStore) {
    return null;
  }

  return (
    <div className="mb-4 flex w-full flex-col gap-2" data-testid="chat-live-answer">
      <div
        className="prose-arbor live-caret mx-0 w-full max-w-none text-sm"
        dangerouslySetInnerHTML={{ __html: renderAnswerHtml(displayText) }}
      />
    </div>
  );
}

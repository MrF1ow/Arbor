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
  onContentChange,
}: {
  root: string;
  course: string;
  onContentChange?: () => void;
}) {
  const key = chatLiveKey(root, course);
  const textFromStore = useSyncExternalStore(subscribeChatLive, () => getChatLiveText(key));
  const [displayText, setDisplayText] = useState(textFromStore);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (textFromStore === "") {
      return;
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
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
  }, [textFromStore]);

  useEffect(() => {
    onContentChange?.();
  }, [displayText, onContentChange]);

  if (!textFromStore) {
    return null;
  }

  return (
    <div className="mb-4 flex w-full flex-col gap-2" data-testid="chat-live-answer">
      <div
        className="prose-arbor mx-0 w-full max-w-none text-sm"
        dangerouslySetInnerHTML={{ __html: renderAnswerHtml(displayText) }}
      />
      <span
        className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-muted-foreground align-middle"
        aria-hidden
      />
    </div>
  );
}

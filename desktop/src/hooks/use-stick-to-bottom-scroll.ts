import { useLayoutEffect, useRef } from "react";

const STICK_THRESHOLD_PX = 24;

export function useStickToBottomScroll(lineCount: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  };

  useLayoutEffect(() => {
    if (!stickToBottomRef.current) {
      return;
    }
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [lineCount]);

  return { scrollRef, onScroll, stickToBottomRef };
}

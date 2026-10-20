import { useVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect } from "react";

import { useStickToBottomScroll } from "~/hooks/use-stick-to-bottom-scroll";
import { useJobStore } from "~/stores/job-store";

export function LogDrawerBody() {
  const lines = useJobStore((s) => s.lines);
  const { scrollRef, onScroll, stickToBottomRef } = useStickToBottomScroll(lines.length);

  // eslint-disable-next-line react-hooks/incompatible-library -- virtualizer row offsets are imperative
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 18,
    overscan: 12,
  });

  useLayoutEffect(() => {
    if (!stickToBottomRef.current || lines.length === 0) {
      return;
    }
    virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
  }, [lines.length, virtualizer, stickToBottomRef]);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-auto px-4 py-2 font-mono text-2xs text-muted-foreground"
    >
      <div
        style={{ height: virtualizer.getTotalSize(), position: "relative" }} // style-allow: virtualizer total height
      >
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute inset-x-0 whitespace-pre-wrap break-words"
            style={{ transform: `translateY(${item.start}px)` }} // style-allow: virtualizer row offset
          >
            {lines[item.index]}
          </div>
        ))}
      </div>
    </div>
  );
}

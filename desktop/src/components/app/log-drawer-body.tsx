import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";

import { useJobStore } from "~/stores/job-store";

export function LogDrawerBody() {
  const lines = useJobStore((s) => s.lines);
  const scrollRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library -- virtualizer row offsets are imperative
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 18,
    overscan: 12,
  });

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
      virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
    }
  }, [lines.length, virtualizer]);

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-auto px-4 py-2 font-mono text-2xs text-muted-foreground"
    >
      <div
        style={{ height: virtualizer.getTotalSize(), position: "relative" }} // style-allow: virtualizer total height
      >
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            className="absolute inset-x-0 whitespace-pre-wrap"
            style={{ transform: `translateY(${item.start}px)` }} // style-allow: virtualizer row offset
          >
            {lines[item.index]}
          </div>
        ))}
      </div>
    </div>
  );
}

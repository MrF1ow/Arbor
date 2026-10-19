import { useVirtualizer } from "@tanstack/react-virtual";
import { Eraser, Terminal, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { IconButton } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";

const LOG_MIN = 120;

export function LogDrawer() {
  const logOpen = useUiStore((s) => s.logOpen);
  const logHeight = useUiStore((s) => s.logHeight);
  const setLogOpen = useUiStore((s) => s.setLogOpen);
  const setLogHeight = useUiStore((s) => s.setLogHeight);
  const lines = useJobStore((s) => s.lines);
  const markRead = useJobStore((s) => s.markRead);
  const clear = useJobStore((s) => s.clear);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState(LOG_MIN);

  useEffect(() => {
    const updateMax = () => {
      setMaxHeight(Math.max(LOG_MIN, Math.floor(window.innerHeight * 0.6)));
    };
    updateMax();
    window.addEventListener("resize", updateMax);
    return () => window.removeEventListener("resize", updateMax);
  }, []);

  useEffect(() => {
    if (logOpen) {
      markRead();
    }
  }, [logOpen, markRead]);

  // eslint-disable-next-line react-hooks/incompatible-library -- virtualizer row offsets are imperative
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 18,
    overscan: 12,
  });

  useEffect(() => {
    if (!logOpen || lines.length === 0) {
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
  }, [lines.length, logOpen, virtualizer]);

  const onResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = logHeight;
    const onMove = (move: PointerEvent) => {
      const delta = startY - move.clientY;
      const next = Math.min(maxHeight, Math.max(LOG_MIN, startHeight + delta));
      setLogHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const height = logOpen ? logHeight : 0;

  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 z-drawer flex flex-col overflow-hidden border-border bg-card transition-[height] duration-panel ease-out-soft",
        logOpen && "border-t shadow-card",
      )}
      style={{ height }}
      aria-hidden={!logOpen}
    >
      {logOpen ? (
        <button
          type="button"
          aria-label="Resize log"
          className="absolute inset-x-0 top-0 z-floating h-1 cursor-row-resize border-0 bg-transparent"
          onPointerDown={onResizePointerDown}
        />
      ) : null}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4 text-xs font-semibold">
        <Terminal className="size-icon-sm text-muted-foreground" aria-hidden />
        Log
        <span className="flex-1" />
        <IconButton icon={Eraser} label="Clear log" size="icon-sm" variant="ghost" onClick={clear} />
        <IconButton
          icon={X}
          label="Close log"
          size="icon-sm"
          variant="ghost"
          onClick={() => setLogOpen(false)}
        />
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-4 py-2 font-mono text-2xs text-muted-foreground">
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
    </div>
  );
}

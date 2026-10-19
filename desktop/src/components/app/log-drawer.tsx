import { Eraser, Terminal, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { IconButton } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";

const LOG_MIN = 120;

const LogDrawerBody = lazy(() =>
  import("~/components/app/log-drawer-body").then((m) => ({ default: m.LogDrawerBody })),
);

export function LogDrawer() {
  const logOpen = useUiStore((s) => s.logOpen);
  const logHeight = useUiStore((s) => s.logHeight);
  const setLogOpen = useUiStore((s) => s.setLogOpen);
  const setLogHeight = useUiStore((s) => s.setLogHeight);
  const markRead = useJobStore((s) => s.markRead);
  const clear = useJobStore((s) => s.clear);
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

  const clampHeight = (next: number) => Math.min(maxHeight, Math.max(LOG_MIN, next));

  const onResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = logHeight;
    const onMove = (move: PointerEvent) => {
      const delta = startY - move.clientY;
      setLogHeight(clampHeight(startHeight + delta));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onResizeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 40 : 16;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setLogHeight(clampHeight(logHeight + step));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setLogHeight(clampHeight(logHeight - step));
    }
  };

  const height = logOpen ? clampHeight(logHeight) : 0;

  if (!logOpen) {
    return null;
  }

  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 z-drawer flex flex-col overflow-hidden border-t border-border bg-card shadow-card",
      )}
      style={{ height }} // style-allow: log drawer height from ui-store + clamp
    >
      <div className="flex shrink-0 flex-col">
        <button
          type="button"
          aria-label="Resize log"
          className="mx-auto h-1.5 w-16 shrink-0 cursor-row-resize rounded-full border-0 bg-muted p-0 hover:bg-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          onPointerDown={onResizePointerDown}
          onKeyDown={onResizeKeyDown}
        />
        <div className="flex h-9 items-center gap-2 border-b border-border px-4 text-xs font-semibold">
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
      </div>
      <Suspense fallback={null}>
        <LogDrawerBody />
      </Suspense>
    </div>
  );
}

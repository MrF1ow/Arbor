import { Eraser, Terminal, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Button, IconButton } from "~/components/ui/button";
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

  const height = logOpen ? Math.min(maxHeight, Math.max(LOG_MIN, logHeight)) : 0;

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
      <Button
        type="button"
        variant="ghost"
        aria-label="Resize log"
        className="absolute inset-x-0 top-0 z-floating h-1 cursor-row-resize rounded-none p-0 hover:bg-transparent"
        onPointerDown={onResizePointerDown}
      />
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
      <Suspense fallback={null}>
        <LogDrawerBody />
      </Suspense>
    </div>
  );
}

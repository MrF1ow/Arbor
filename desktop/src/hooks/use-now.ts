import { useEffect, useState } from "react";

export function useNow(intervalMs = 60_000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, intervalMs);
    return () => {
      window.clearInterval(id);
    };
  }, [intervalMs]);

  return nowMs;
}

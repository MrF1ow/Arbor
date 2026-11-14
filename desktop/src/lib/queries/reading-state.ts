import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import type { ReadingEntry } from "~/domain/lectures";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

/** Reading progress for every digest in a library, keyed by `Course/digests/x.md`. */
export function useReadingState(root: string | null) {
  return useQuery({
    queryKey: qk.readingState(root ?? ""),
    enabled: Boolean(root),
    queryFn: () => invoke<Record<string, ReadingEntry>>("read_reading_state", { root: root! }),
  });
}

/** At most one write per digest in this window; the latest fraction goes out when it ends. */
export const READING_WRITE_INTERVAL_MS = 2000;

type Slot = {
  /** The library this digest's pending write belongs to, fixed when the write is scheduled. */
  root: string;
  digest: string;
  lastSentAt: number;
  lastFraction: number;
  pending: number | null;
  timer: ReturnType<typeof setTimeout> | null;
};

/**
 * Throttled `write_reading_state`: the first write for a digest goes out at once, later ones
 * wait until 2 s after the last send, only increases are sent (the backend keeps the maximum
 * anyway), and a pending write is flushed on unmount. Each pending write remembers the
 * library it was made in, so a library switch never redirects it; a failed write is not
 * counted as sent, so the next scroll retries it.
 */
export function useWriteReadingState(root: string | null) {
  const queryClient = useQueryClient();
  const slots = useRef(new Map<string, Slot>());

  const send = useCallback(
    (slot: Slot, fraction: number) => {
      const previous = slot.lastFraction;
      slot.lastSentAt = Date.now();
      slot.lastFraction = fraction;
      slot.pending = null;
      invoke("write_reading_state", { root: slot.root, digest: slot.digest, fraction }).then(
        () => {
          void queryClient.invalidateQueries({ queryKey: qk.readingState(slot.root) });
        },
        () => {
          if (slot.lastFraction === fraction) {
            slot.lastFraction = previous;
          }
        },
      );
    },
    [queryClient],
  );

  const write = useCallback(
    (digest: string, fraction: number) => {
      if (!root) {
        return;
      }
      const key = `${root}::${digest}`;
      let slot = slots.current.get(key);
      if (!slot) {
        slot = { root, digest, lastSentAt: -Infinity, lastFraction: -1, pending: null, timer: null };
        slots.current.set(key, slot);
      }
      if (fraction <= Math.max(slot.lastFraction, slot.pending ?? -1)) {
        return;
      }
      const wait = slot.lastSentAt + READING_WRITE_INTERVAL_MS - Date.now();
      if (wait <= 0 && slot.timer === null) {
        send(slot, fraction);
        return;
      }
      slot.pending = fraction;
      if (slot.timer === null) {
        const owner = slot;
        slot.timer = setTimeout(() => {
          owner.timer = null;
          if (owner.pending !== null) {
            send(owner, owner.pending);
          }
        }, Math.max(wait, 0));
      }
    },
    [root, send],
  );

  useEffect(() => {
    const map = slots.current;
    return () => {
      for (const slot of map.values()) {
        if (slot.timer !== null) {
          clearTimeout(slot.timer);
          slot.timer = null;
        }
        if (slot.pending !== null) {
          send(slot, slot.pending);
        }
      }
    };
  }, [send]);

  return { write };
}

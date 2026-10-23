import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { invoke } from "~/lib/ipc";

export type DictationPhase = "idle" | "starting" | "listening" | "stopping";

export type DictationBase = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
};

type DictationEvent =
  | { kind: "listening" }
  | { kind: "partial"; text: string }
  | { kind: "final"; text: string }
  | { kind: "error"; code: string; message: string };

export function spliceDictation(
  base: DictationBase,
  spoken: string,
): { text: string; caret: number } {
  const trimmed = spoken.trim();
  if (!trimmed) {
    return { text: base.text, caret: base.selectionEnd };
  }
  const { text, selectionStart, selectionEnd } = base;
  let leading = "";
  if (selectionStart > 0 && !/\s/.test(text[selectionStart - 1]!)) {
    leading = " ";
  }
  let trailing = "";
  if (selectionEnd < text.length && !/\s/.test(text[selectionEnd]!)) {
    trailing = " ";
  }
  const insert = `${leading}${trimmed}${trailing}`;
  const nextText = text.slice(0, selectionStart) + insert + text.slice(selectionEnd);
  const caret = selectionStart + leading.length + trimmed.length;
  return { text: nextText, caret };
}

function parseDictationEvent(raw: unknown): DictationEvent | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const event = raw as Record<string, unknown>;
  const kind = event.kind;
  if (kind === "listening") {
    return { kind: "listening" };
  }
  if (kind === "partial" && typeof event.text === "string") {
    return { kind: "partial", text: event.text };
  }
  if (kind === "final" && typeof event.text === "string") {
    return { kind: "final", text: event.text };
  }
  if (kind === "error" && typeof event.code === "string" && typeof event.message === "string") {
    return { kind: "error", code: event.code, message: event.message };
  }
  return null;
}

function showDictationError(code: string, message: string) {
  if (code === "microphone_denied" || code === "speech_denied") {
    const pane = code === "microphone_denied" ? "microphone" : "speech";
    toast.error(message, {
      action: {
        label: "Open Settings",
        onClick: () => {
          void invoke("open_privacy_settings", { pane });
        },
      },
    });
    return;
  }
  toast.error(message);
}

export type UseDictationOpts = {
  onDraft: (text: string) => void;
  onApplyFinal: (text: string, caret: number) => void;
};

export function useDictation({ onDraft, onApplyFinal }: UseDictationOpts) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [listeningStartedAt, setListeningStartedAt] = useState<number | null>(null);
  const [elapsedTick, setElapsedTick] = useState(0);
  const baseRef = useRef<DictationBase | null>(null);
  const sessionRef = useRef(0);

  useEffect(() => {
    if (phase !== "listening" || listeningStartedAt == null) {
      return;
    }
    const id = window.setInterval(() => {
      setElapsedTick(Date.now());
    }, 500);
    return () => window.clearInterval(id);
  }, [phase, listeningStartedAt]);

  const elapsedLabel =
    phase === "listening" && listeningStartedAt != null
      ? formatDictationElapsed(Math.max(0, elapsedTick - listeningStartedAt))
      : null;

  const cancel = useCallback(() => {
    sessionRef.current += 1;
    const base = baseRef.current;
    baseRef.current = null;
    setPhase("idle");
    setListeningStartedAt(null);
    void invoke("cancel_dictation");
    if (base) {
      onDraft(base.text);
    }
  }, [onDraft]);

  const start = useCallback(
    async (base: DictationBase) => {
      const token = sessionRef.current + 1;
      sessionRef.current = token;
      baseRef.current = base;
      setPhase("starting");
      setListeningStartedAt(null);

      const channel = new Channel<unknown>();
      channel.onmessage = (raw) => {
        if (sessionRef.current !== token) {
          return;
        }
        const event = parseDictationEvent(raw);
        if (!event) {
          return;
        }
        if (event.kind === "listening") {
          setPhase("listening");
          setListeningStartedAt(Date.now());
          setElapsedTick(Date.now());
          return;
        }
        if (event.kind === "partial") {
          onDraft(spliceDictation(base, event.text).text);
          return;
        }
        if (event.kind === "final") {
          const { text, caret } = spliceDictation(base, event.text);
          baseRef.current = null;
          setPhase("idle");
          setListeningStartedAt(null);
          onApplyFinal(text, caret);
          return;
        }
        if (event.kind === "error") {
          const base = baseRef.current;
          baseRef.current = null;
          setPhase("idle");
          setListeningStartedAt(null);
          if (base) {
            onDraft(base.text);
          }
          showDictationError(event.code, event.message);
        }
      };

      try {
        await invoke("start_dictation", { onEvent: channel });
      } catch (error) {
        if (sessionRef.current !== token) {
          return;
        }
        const base = baseRef.current;
        baseRef.current = null;
        setPhase("idle");
        setListeningStartedAt(null);
        if (base) {
          onDraft(base.text);
        }
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [onApplyFinal, onDraft],
  );

  const stop = useCallback(() => {
    if (phase !== "listening") {
      return;
    }
    setPhase("stopping");
    void invoke("stop_dictation");
  }, [phase]);

  const dictationActive = phase !== "idle";

  return {
    phase,
    dictationActive,
    elapsedLabel,
    start,
    stop,
    cancel,
  };
}

function formatDictationElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

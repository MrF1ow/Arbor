import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  trimStudySessions,
  type SavedStudySession,
} from "~/domain/study-session";

interface StudySessionState {
  sessions: Record<string, SavedStudySession>;
  save: (key: string, value: SavedStudySession) => void;
  clear: (key: string) => void;
}

export const useStudySessionStore = create<StudySessionState>()(
  persist(
    (set) => ({
      sessions: {},
      save: (key, value) =>
        set((state) => ({
          sessions: trimStudySessions({ ...state.sessions, [key]: value }),
        })),
      clear: (key) =>
        set((state) => {
          if (!(key in state.sessions)) {
            return state;
          }
          const next = { ...state.sessions };
          delete next[key];
          return { sessions: next };
        }),
    }),
    {
      name: "arbor.study-sessions",
      version: 1,
      partialize: (state) => ({ sessions: state.sessions }),
    },
  ),
);

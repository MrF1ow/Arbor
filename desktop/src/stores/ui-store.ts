import { create } from "zustand";
import { persist } from "zustand/middleware";

import { parseAppearance } from "~/domain/theme";
import type { Appearance } from "~/domain/types";

export type LastCourse = { root: string; course: string };

interface UiState {
  appearance: Appearance;
  sidebarOpen: boolean;
  sidebarTouched: boolean;
  logOpen: boolean;
  logHeight: number;
  notesIndexOpen: boolean;
  lastCourse: LastCourse | null;
  setAppearance: (appearance: Appearance) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  markSidebarTouched: () => void;
  setLogOpen: (open: boolean) => void;
  toggleLog: () => void;
  setLogHeight: (height: number) => void;
  setNotesIndexOpen: (open: boolean) => void;
  setLastCourse: (last: LastCourse | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      appearance: "system",
      sidebarOpen: true,
      sidebarTouched: false,
      logOpen: false,
      logHeight: 200,
      notesIndexOpen: true,
      lastCourse: null,
      setAppearance: (appearance) => set({ appearance }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleSidebar: () =>
        set((s) => ({ sidebarOpen: !s.sidebarOpen, sidebarTouched: true })),
      markSidebarTouched: () => set({ sidebarTouched: true }),
      setLogOpen: (logOpen) => set({ logOpen }),
      toggleLog: () => set((s) => ({ logOpen: !s.logOpen })),
      setLogHeight: (logHeight) => set({ logHeight }),
      setNotesIndexOpen: (notesIndexOpen) => set({ notesIndexOpen }),
      setLastCourse: (lastCourse) => set({ lastCourse }),
    }),
    {
      name: "arbor.ui",
      partialize: (state) => ({
        appearance: state.appearance,
        sidebarOpen: state.sidebarOpen,
        sidebarTouched: state.sidebarTouched,
        logOpen: state.logOpen,
        logHeight: state.logHeight,
        notesIndexOpen: state.notesIndexOpen,
        lastCourse: state.lastCourse,
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<UiState> | undefined;
        const parsed =
          stored?.appearance != null ? parseAppearance(String(stored.appearance)) : null;
        return {
          ...current,
          ...stored,
          appearance: parsed ?? "system",
        };
      },
    },
  ),
);

/** First-run responsive default: hidden below lg until the user toggles the sidebar. */
export function useEffectiveSidebarOpen(): boolean {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const sidebarTouched = useUiStore((s) => s.sidebarTouched);
  if (sidebarTouched) {
    return sidebarOpen;
  }
  if (typeof window === "undefined") {
    return sidebarOpen;
  }
  if (window.innerWidth < 1024) {
    return false;
  }
  return sidebarOpen;
}

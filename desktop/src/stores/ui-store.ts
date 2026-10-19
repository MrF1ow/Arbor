import { create } from "zustand";
import { persist } from "zustand/middleware";

import { parseAppearance } from "~/domain/theme";
import type { Appearance } from "~/domain/types";

interface UiState {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      appearance: "system",
      setAppearance: (appearance) => set({ appearance }),
    }),
    {
      name: "arbor.ui",
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

// PR 4: sync with get_settings/save_settings

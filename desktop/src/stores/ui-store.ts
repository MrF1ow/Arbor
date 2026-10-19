import { create } from "zustand";
import { persist } from "zustand/middleware";

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
    },
  ),
);

// PR 4: sync with get_settings/save_settings

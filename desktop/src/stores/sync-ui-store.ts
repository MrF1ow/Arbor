import { create } from "zustand";

interface SyncUiState {
  syncConflictOpen: boolean;
  setSyncConflictOpen: (open: boolean) => void;
}

export const useSyncUiStore = create<SyncUiState>((set) => ({
  syncConflictOpen: false,
  setSyncConflictOpen: (syncConflictOpen) => set({ syncConflictOpen }),
}));

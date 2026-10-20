import { create } from "zustand";

interface StudyWritesState {
  pending: number;
  failing: boolean;
  setStatus: (status: { pending: number; failing: boolean }) => void;
}

export const useStudyWritesStore = create<StudyWritesState>((set) => ({
  pending: 0,
  failing: false,
  setStatus: (status) => set(status),
}));

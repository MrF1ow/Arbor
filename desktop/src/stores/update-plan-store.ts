import { create } from "zustand";

import type { PendingSource } from "~/domain/types";

interface UpdatePlanState {
  pending: PendingSource[] | null;
  open: boolean;
  setPendingPlan: (pending: PendingSource[] | null, open: boolean) => void;
}

export const useUpdatePlanStore = create<UpdatePlanState>((set) => ({
  pending: null,
  open: false,
  setPendingPlan: (pending, open) => set({ pending, open }),
}));

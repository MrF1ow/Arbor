import { create } from "zustand";

import type { PendingSource } from "~/domain/types";

export type UpdatePlanTrigger = "manual" | "watch";

interface UpdatePlanState {
  pending: PendingSource[] | null;
  open: boolean;
  trigger: UpdatePlanTrigger;
  setPendingPlan: (
    pending: PendingSource[] | null,
    open: boolean,
    trigger?: UpdatePlanTrigger,
  ) => void;
  close: () => void;
}

export const useUpdatePlanStore = create<UpdatePlanState>((set) => ({
  pending: null,
  open: false,
  trigger: "manual",
  setPendingPlan: (pending, open, trigger = "manual") =>
    set({ pending, open, trigger }),
  close: () => set({ pending: null, open: false, trigger: "manual" }),
}));

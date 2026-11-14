import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The right-hand end of the bar above a view ("lecture-07.pdf · 24 slides"); each view fills it. */
export const PreviewBarSlotContext = createContext<HTMLElement | null>(null);

export function PreviewBarRight({ children }: { children: ReactNode }) {
  const slot = useContext(PreviewBarSlotContext);
  return slot ? createPortal(children, slot) : null;
}

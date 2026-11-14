import { useEffect, useState, type RefObject } from "react";

/** Matches `@container/notes-main` breakpoint (~44rem). */
const NOTES_MAIN_NARROW_PX = 704;

export function useNotesMainNarrow(
  ref: RefObject<HTMLElement | null>,
  breakpointPx: number = NOTES_MAIN_NARROW_PX,
): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const update = () => {
      const width = el.clientWidth;
      if (width === 0) {
        setNarrow(false);
        return;
      }
      setNarrow(width < breakpointPx);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, breakpointPx]);

  return narrow;
}

import { create } from "zustand";

/** The ticked lectures of every class, keyed by `root::course` so two libraries never mix. */
export const classScopeKey = (root: string, course: string) => `${root}::${course}`;

interface LectureSelectionState {
  /** Course-prefixed digest paths (`Course/digests/x.md`), the form every command takes. */
  byClass: Record<string, string[]>;
  toggle: (key: string, digest: string) => void;
  setScope: (key: string, digests: string[]) => void;
  clear: (key: string) => void;
}

/** Practice, Ask and Map read the ticked lectures as their scope until they are cleared. */
export const useLectureSelectionStore = create<LectureSelectionState>((set) => ({
  byClass: {},
  toggle: (key, digest) =>
    set((state) => {
      const current = state.byClass[key] ?? [];
      const next = current.includes(digest)
        ? current.filter((d) => d !== digest)
        : [...current, digest];
      return { byClass: withKey(state.byClass, key, next) };
    }),
  setScope: (key, digests) =>
    set((state) => ({ byClass: withKey(state.byClass, key, [...new Set(digests)]) })),
  clear: (key) => set((state) => ({ byClass: withKey(state.byClass, key, []) })),
}));

function withKey(
  byClass: Record<string, string[]>,
  key: string,
  digests: string[],
): Record<string, string[]> {
  const { [key]: _dropped, ...rest } = byClass;
  void _dropped;
  return digests.length > 0 ? { ...rest, [key]: digests } : rest;
}

const NONE: string[] = [];

/** The ticked lectures of one class; a stable empty array when nothing is ticked. */
export function useTickedLectures(root: string | null, course: string): string[] {
  return useLectureSelectionStore((s) => (root ? s.byClass[classScopeKey(root, course)] : undefined) ?? NONE);
}

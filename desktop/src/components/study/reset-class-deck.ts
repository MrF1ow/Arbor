import { scopedSessionKey } from "~/components/study/study-scope";
import { classScopeKey, useLectureSelectionStore } from "~/stores/lecture-selection-store";
import { useStudySessionStore } from "~/stores/study-session-store";

/**
 * Open a class's Cards on its due deck (Start review, Next: <class>, Overview's "N cards due").
 * Those entry points promise the class's due cards from the first one, but Cards restores what
 * the class was left on: the lectures ticked there and the saved whole-class session (Full deck,
 * mid-deck). Both are dropped here, before the class opens.
 */
export function resetClassDeck(root: string, course: string): void {
  useLectureSelectionStore.getState().clear(classScopeKey(root, course));
  useStudySessionStore.getState().clear(scopedSessionKey(root, course, "flashcards", []));
}

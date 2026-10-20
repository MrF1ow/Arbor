export type ShortcutEntry = {
  keys: string;
  description: string;
  group?: string;
};

export function modKeyLabel(): "⌘" | "Ctrl" {
  if (typeof navigator === "undefined") {
    return "Ctrl";
  }
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform) ? "⌘" : "Ctrl";
}

export function modShortcut(key: string): string {
  return `${modKeyLabel()}+${key}`;
}

export function modKeyActive(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return modKeyLabel() === "⌘" ? event.metaKey : event.ctrlKey;
}

export const SHORTCUT_CATALOG: ShortcutEntry[] = [
  { keys: modShortcut("B"), description: "Toggle sidebar", group: "General" },
  { keys: modShortcut("`"), description: "Toggle log", group: "General" },
  { keys: modShortcut("K"), description: "Open search", group: "General" },
  { keys: modShortcut("1"), description: "Notes mode", group: "General" },
  { keys: modShortcut("2"), description: "Flashcards mode", group: "General" },
  { keys: modShortcut("3"), description: "Quiz mode", group: "General" },
  { keys: modShortcut("4"), description: "Graph mode", group: "General" },
  { keys: modShortcut("5"), description: "Chat mode", group: "General" },
  { keys: modShortcut(","), description: "Settings", group: "General" },
  { keys: "Space", description: "Flip flashcard (Flashcards view)", group: "Flashcards" },
  { keys: "1", description: "Again (Flashcards, when flipped)", group: "Flashcards" },
  { keys: "2", description: "Wrong (Flashcards, when flipped)", group: "Flashcards" },
  { keys: "3", description: "Mastered (Flashcards, when flipped)", group: "Flashcards" },
  { keys: "←", description: "Previous flashcard (Flashcards view)", group: "Flashcards" },
  { keys: "→", description: "Next flashcard (Flashcards view)", group: "Flashcards" },
  { keys: "1", description: "Select choice 1 (Quiz, before submit)", group: "Quiz" },
  { keys: "2", description: "Select choice 2 (Quiz, before submit)", group: "Quiz" },
  { keys: "3", description: "Select choice 3 (Quiz, before submit)", group: "Quiz" },
  { keys: "4", description: "Select choice 4 (Quiz, before submit)", group: "Quiz" },
  { keys: "Enter", description: "Submit or next question (Quiz view)", group: "Quiz" },
  { keys: "←", description: "Previous question (Quiz view)", group: "Quiz" },
  { keys: "→", description: "Next question (Quiz view)", group: "Quiz" },
  { keys: "↑", description: "Previous concept (Graph list)", group: "Graph" },
  { keys: "↓", description: "Next concept (Graph list)", group: "Graph" },
];

export function isDialogOpen(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return Boolean(
    document.querySelector('[data-slot="dialog-overlay"][data-open]') ??
      document.querySelector('[data-slot="sheet-overlay"][data-open]'),
  );
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return target.isContentEditable;
}

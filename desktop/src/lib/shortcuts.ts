export type ShortcutEntry = {
  keys: string;
  description: string;
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
  { keys: modShortcut("B"), description: "Toggle sidebar" },
  { keys: modShortcut("`"), description: "Toggle log" },
  { keys: modShortcut("K"), description: "Open search" },
  { keys: modShortcut("1"), description: "Notes mode" },
  { keys: modShortcut("2"), description: "Flashcards mode" },
  { keys: modShortcut("3"), description: "Quiz mode" },
  { keys: modShortcut("4"), description: "Graph mode" },
  { keys: modShortcut("5"), description: "Chat mode" },
  { keys: modShortcut(","), description: "Settings" },
  { keys: "Space", description: "Flip flashcard (Flashcards view)" },
  { keys: "1", description: "Again (Flashcards, when flipped)" },
  { keys: "2", description: "Wrong (Flashcards, when flipped)" },
  { keys: "3", description: "Mastered (Flashcards, when flipped)" },
  { keys: "←", description: "Previous flashcard (Flashcards view)" },
  { keys: "→", description: "Next flashcard (Flashcards view)" },
];

export function isDialogOpen(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return Boolean(document.querySelector('[data-slot="dialog-overlay"][data-open]'));
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

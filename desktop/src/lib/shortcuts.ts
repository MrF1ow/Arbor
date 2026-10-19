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
  return `${modKeyLabel()}${key}`;
}

export const SHORTCUT_CATALOG: ShortcutEntry[] = [
  { keys: modShortcut("B"), description: "Toggle sidebar" },
  { keys: `${modKeyLabel()}+\``, description: "Toggle log" },
  { keys: modShortcut("K"), description: "Open search" },
  { keys: modShortcut("1"), description: "Notes mode" },
  { keys: modShortcut("2"), description: "Flashcards mode" },
  { keys: modShortcut("3"), description: "Quiz mode" },
  { keys: modShortcut("4"), description: "Graph mode" },
  { keys: modShortcut("5"), description: "Chat mode" },
  { keys: modShortcut(","), description: "Settings" },
];

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

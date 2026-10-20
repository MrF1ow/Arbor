export const TAURI_UNAVAILABLE =
  "Arbor must run in the desktop window, not a browser tab.";

export function hasTauriInvoke(win: object): boolean {
  if (!("__TAURI_INTERNALS__" in win)) return false;
  const internals = win.__TAURI_INTERNALS__;
  if (typeof internals !== "object" || internals === null) return false;
  if (!("invoke" in internals)) return false;
  return typeof internals.invoke === "function";
}

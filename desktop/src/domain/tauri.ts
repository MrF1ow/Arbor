export const TAURI_UNAVAILABLE =
  "Arbor must run in the desktop window, not a browser tab.";

export const DESKTOP_ONLY_WELCOME_COPY =
  "This is the Vite dev server. Open the Arbor desktop window; a browser tab cannot talk to the worker.";

export function isMockMode(): boolean {
  return import.meta.env.MODE === "mock";
}

/** True when `invoke` and Tauri dialogs are expected to work (desktop or dev:mock). */
export function canUseDesktopIpc(): boolean {
  return hasTauriInvoke(globalThis) || isMockMode();
}

export function hasTauriInvoke(win: object): boolean {
  if (!("__TAURI_INTERNALS__" in win)) return false;
  const internals = win.__TAURI_INTERNALS__;
  if (typeof internals !== "object" || internals === null) return false;
  if (!("invoke" in internals)) return false;
  return typeof internals.invoke === "function";
}

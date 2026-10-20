import { useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";

import { resolvedTheme } from "~/domain/theme";
import { applyDocumentTheme } from "~/lib/document-theme";
import { useUiStore } from "~/stores/ui-store";

function subscribeSystemDark(onStoreChange: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getSystemDarkSnapshot(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getSystemDarkServerSnapshot(): boolean {
  return false;
}

const noopSubscribe = () => () => {};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const appearance = useUiStore((state) => state.appearance);
  const systemPrefersDark = useSyncExternalStore(
    appearance === "system" ? subscribeSystemDark : noopSubscribe,
    appearance === "system" ? getSystemDarkSnapshot : () => false,
    getSystemDarkServerSnapshot,
  );
  const theme = resolvedTheme(appearance, systemPrefersDark);

  useLayoutEffect(() => {
    applyDocumentTheme(theme);
  }, [theme]);

  return children;
}

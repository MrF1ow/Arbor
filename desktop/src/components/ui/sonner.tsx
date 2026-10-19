import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useUiStore } from "~/stores/ui-store";
import { resolvedTheme } from "~/domain/theme";
import { useSyncExternalStore } from "react";

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

function Toaster({ ...props }: ToasterProps) {
  const appearance = useUiStore((state) => state.appearance);
  const systemPrefersDark = useSyncExternalStore(
    appearance === "system" ? subscribeSystemDark : noopSubscribe,
    appearance === "system" ? getSystemDarkSnapshot : () => false,
    getSystemDarkServerSnapshot,
  );
  const theme = resolvedTheme(appearance, systemPrefersDark);

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast flex items-center gap-3 rounded-md border border-border bg-card text-foreground shadow-card",
          success: "border-l-2 border-l-success pl-3",
          error: "border-l-2 border-l-destructive pl-3",
          info: "border-l-2 border-l-info pl-3",
          actionButton:
            "rounded-sm border border-border bg-muted px-2 py-1 text-xs font-medium text-foreground hover:bg-accent",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };

import { useSyncExternalStore } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { buttonVariants } from "~/components/ui/button";
import { resolvedTheme } from "~/domain/theme";
import { cn } from "~/lib/utils";
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
      className="toaster group z-toast"
      position="bottom-right"
      style={{ zIndex: "var(--z-index-toast)" }} // style-allow: sonner injects unlayered z-index
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: cn(
            "group toast flex w-full items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-card-foreground shadow-card",
          ),
          title: "text-sm font-medium text-card-foreground",
          description: "text-xs text-muted-foreground",
          success: "border-l-2 border-l-success pl-3",
          error: "border-l-2 border-l-destructive pl-3",
          info: "border-l-2 border-l-info pl-3",
          actionButton: cn(buttonVariants({ variant: "outline", size: "xs" })),
        },
      }}
      {...props}
    />
  );
}

export { Toaster };

import * as React from "react";

type TooltipModule = typeof import("~/components/ui/tooltip");

const TooltipModulePromise = import("~/components/ui/tooltip");

let preloadScheduled = false;

function scheduleTooltipPreload() {
  if (preloadScheduled || typeof window === "undefined") {
    return;
  }
  preloadScheduled = true;
  const run = () => {
    void TooltipModulePromise;
  };
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(run);
  } else {
    setTimeout(run, 0);
  }
}

scheduleTooltipPreload();

type LazyTooltipContextValue = {
  mod: TooltipModule | null;
};

const LazyTooltipContext = React.createContext<LazyTooltipContextValue | null>(null);

function useLazyTooltipContext() {
  const ctx = React.useContext(LazyTooltipContext);
  if (!ctx) {
    throw new Error("LazyTooltip components must be used within LazyTooltip");
  }
  return ctx;
}

function LazyTooltip({
  children,
  ...props
}: React.ComponentProps<TooltipModule["Tooltip"]>) {
  const [mod, setMod] = React.useState<TooltipModule | null>(null);

  React.useEffect(() => {
    void TooltipModulePromise.then(setMod);
  }, []);

  const value = React.useMemo(() => ({ mod }), [mod]);

  if (!mod) {
    return <LazyTooltipContext.Provider value={value}>{children as React.ReactNode}</LazyTooltipContext.Provider>;
  }

  return (
    <LazyTooltipContext.Provider value={value}>
      {React.createElement(mod.Tooltip, props, children as React.ReactNode)}
    </LazyTooltipContext.Provider>
  );
}

function LazyTooltipTrigger(
  props: React.ComponentProps<TooltipModule["TooltipTrigger"]>,
): React.ReactElement | null {
  const { mod } = useLazyTooltipContext();
  const { render, ...rest } = props;

  if (typeof render === "function") {
    if (!mod) {
      return render({}, { open: false }) as React.ReactElement;
    }
    return React.createElement(mod.TooltipTrigger, { ...rest, render }) as React.ReactElement;
  }

  if (render != null && !mod) {
    return <>{render}</>;
  }
  if (!mod) {
    return null;
  }
  return React.createElement(mod.TooltipTrigger, props) as React.ReactElement;
}

function LazyTooltipContent(props: React.ComponentProps<TooltipModule["TooltipContent"]>) {
  const { mod } = useLazyTooltipContext();
  if (!mod) {
    return null;
  }
  return React.createElement(mod.TooltipContent, props);
}

export { LazyTooltip, LazyTooltipTrigger, LazyTooltipContent };

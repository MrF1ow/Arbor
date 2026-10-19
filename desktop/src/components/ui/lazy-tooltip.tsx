import * as React from "react";

type TooltipModule = typeof import("~/components/ui/tooltip");

const TooltipModulePromise = import("~/components/ui/tooltip");

type LazyTooltipContextValue = {
  mod: TooltipModule | null;
  activate: () => void;
};

const LazyTooltipContext = React.createContext<LazyTooltipContextValue | null>(null);

function useLazyTooltipContext() {
  const ctx = React.useContext(LazyTooltipContext);
  if (!ctx) {
    throw new Error("LazyTooltip components must be used within LazyTooltip");
  }
  return ctx;
}

function useTooltipModule(active: boolean) {
  const [mod, setMod] = React.useState<TooltipModule | null>(null);

  React.useEffect(() => {
    if (!active || mod) {
      return;
    }
    void TooltipModulePromise.then(setMod);
  }, [active, mod]);

  return mod;
}

function LazyTooltipActivator({
  children,
  onActivate,
}: {
  children: React.ReactNode;
  onActivate: () => void;
}) {
  return (
    <span
      className="contents"
      onPointerEnter={onActivate}
      onFocus={onActivate}
    >
      {children}
    </span>
  );
}

function LazyTooltip({
  children,
  ...props
}: React.ComponentProps<TooltipModule["Tooltip"]>) {
  const [active, setActive] = React.useState(false);
  const mod = useTooltipModule(active);
  const activate = () => setActive(true);

  const value = React.useMemo(() => ({ mod, activate }), [mod]);

  if (!mod) {
    return (
      <LazyTooltipContext.Provider value={value}>
        <LazyTooltipActivator onActivate={activate}>{children as React.ReactNode}</LazyTooltipActivator>
      </LazyTooltipContext.Provider>
    );
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
  if (!mod) {
    const rendered = props.render;
    if (rendered == null || typeof rendered === "function") {
      return null;
    }
    return <>{rendered}</>;
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

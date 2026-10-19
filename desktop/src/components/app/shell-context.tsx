import { createContext, useContext } from "react";

export type ShellContextValue = {
  onOpenSearch: () => void;
};

const ShellContext = createContext<ShellContextValue>({
  onOpenSearch: () => {},
});

export function ShellContextProvider({
  value,
  children,
}: {
  value: ShellContextValue;
  children: React.ReactNode;
}) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShellContext() {
  return useContext(ShellContext);
}

import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { classPath, type ClassSearch, type ClassTab } from "~/lib/class-path";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useSwitchActiveRootMutation } from "~/lib/queries/active-root";
import { useSettings } from "~/lib/queries/settings";

export type OpenClassTarget = ClassTab | { tab: "read"; digest: string };

/** The params a class link can carry: the ticked lectures, plus the item a Search hit opens. */
export type OpenClassSearch = ClassSearch & { card?: string; concept?: string; heading?: string };

/**
 * Open a class view from anywhere, including a class in another library (Q10). `/course/$course`
 * only looks in the active library, so when `root` is not the active one the library is switched
 * first, exactly as the sidebar does, and then the route is opened. Today, Search, Jobs and
 * Start review use this for every class link.
 */
export function useOpenClass() {
  const navigate = useNavigate();
  const settings = useSettings();
  const switchRoot = useSwitchActiveRootMutation();
  const { mutateAsync } = switchRoot;
  const activeRoot = pickActiveRoot(settings.data);

  return useCallback(
    async (root: string, course: string, to: OpenClassTarget, search?: OpenClassSearch) => {
      if (root !== activeRoot) {
        await mutateAsync(root);
      }
      const link = typeof to === "string" ? classPath(course, to) : classPath(course, to.tab, to.digest);
      await navigate({ ...link, search: search ?? {} });
    },
    [activeRoot, mutateAsync, navigate],
  );
}

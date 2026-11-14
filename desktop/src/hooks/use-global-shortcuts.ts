import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";

import { classPath, type ClassTab } from "~/lib/class-path";
import { isEditableTarget, modKeyActive } from "~/lib/shortcuts";
import { useUiStore } from "~/stores/ui-store";

type GlobalShortcutHandlers = {
  onSearch: () => void;
};

export function useGlobalShortcuts(handlers: GlobalShortcutHandlers) {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const course = typeof params.course === "string" ? params.course : undefined;
  const toggleLog = useUiStore((s) => s.toggleLog);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!modKeyActive(event)) {
        return;
      }

      if (event.key === "`") {
        if (isEditableTarget(event.target)) {
          return;
        }
        event.preventDefault();
        toggleLog();
        return;
      }

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        handlers.onSearch();
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.key === ",") {
        event.preventDefault();
        void navigate({ to: "/settings/general" });
        return;
      }

      if (!course) {
        return;
      }

      const modeTabs: Record<string, ClassTab> = {
        "1": "overview",
        "2": "cards",
        "3": "quiz",
        "4": "map",
        "5": "ask",
      };
      const tab = modeTabs[event.key];
      if (tab) {
        event.preventDefault();
        void navigate(classPath(course, tab));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers, navigate, course, toggleLog]);
}

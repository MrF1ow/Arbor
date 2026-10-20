import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";

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

      const modeRoutes: Record<string, string> = {
        "1": "/course/$course/notes",
        "2": "/course/$course/flashcards",
        "3": "/course/$course/quiz",
        "4": "/course/$course/graph",
        "5": "/course/$course/chat",
      };
      const to = modeRoutes[event.key];
      if (to) {
        event.preventDefault();
        void navigate({ to, params: { course } });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers, navigate, course, toggleLog]);
}

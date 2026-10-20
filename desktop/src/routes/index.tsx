import { createFileRoute, redirect } from "@tanstack/react-router";

import { canUseDesktopIpc } from "~/domain/tauri";
import { hasAnyKnowledgeRoot, pickActiveRoot } from "~/lib/knowledge-root";
import { invoke } from "~/lib/ipc";
import type { Settings } from "~/domain/types";
import { useUiStore } from "~/stores/ui-store";

export const Route = createFileRoute("/")({
  loader: async () => {
    if (!canUseDesktopIpc()) {
      throw redirect({ to: "/welcome" });
    }
    const settings = await invoke<Settings>("get_settings");
    if (!hasAnyKnowledgeRoot(settings)) {
      throw redirect({ to: "/welcome" });
    }
    const activeRoot = pickActiveRoot(settings);
    if (!activeRoot) {
      throw redirect({ to: "/welcome" });
    }
    const courses = await invoke<string[]>("list_courses", { root: activeRoot });
    const lastCourse = useUiStore.getState().lastCourse;
    if (lastCourse && lastCourse.root === activeRoot && courses.includes(lastCourse.course)) {
      throw redirect({
        to: "/course/$course/notes",
        params: { course: lastCourse.course },
      });
    }
    if (courses[0]) {
      throw redirect({ to: "/course/$course/notes", params: { course: courses[0] } });
    }
    throw redirect({ to: "/welcome" });
  },
  component: () => null,
});

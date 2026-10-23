import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { CourseMetaMap } from "~/domain/course-icons";
import { canUseDesktopIpc } from "~/domain/tauri";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

export function useCourseMeta(root: string | null) {
  return useQuery({
    queryKey: qk.courseMeta(root ?? ""),
    enabled: Boolean(root) && canUseDesktopIpc(),
    queryFn: () => invoke<CourseMetaMap>("read_course_meta", { root: root! }),
  });
}

export function useSetCourseMeta(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      course: string;
      icon: string | null;
      color: string | null;
    }) =>
      invoke<CourseMetaMap>("set_course_meta", {
        root: root!,
        course: input.course,
        icon: input.icon,
        color: input.color,
      }),
    onMutate: async (input) => {
      if (!root) {
        return;
      }
      const key = qk.courseMeta(root);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CourseMetaMap>(key);
      queryClient.setQueryData<CourseMetaMap>(key, (old) => {
        const next = { ...(old ?? {}) };
        const entry = { ...(next[input.course] ?? {}) };
        if (input.icon === null) {
          delete entry.icon;
        } else {
          entry.icon = input.icon;
        }
        if (input.color === null) {
          delete entry.color;
        } else {
          entry.color = input.color;
        }
        if (!entry.icon && !entry.color) {
          delete next[input.course];
        } else {
          next[input.course] = entry;
        }
        return next;
      });
      return { previous };
    },
    onError: (err, _input, context) => {
      if (root) {
        const key = qk.courseMeta(root);
        if (context) {
          if (context.previous === undefined) {
            queryClient.removeQueries({ queryKey: key });
          } else {
            queryClient.setQueryData(key, context.previous);
          }
        }
      }
      toast.error(String(err));
    },
    onSettled: () => {
      if (root) {
        void queryClient.invalidateQueries({ queryKey: qk.courseMeta(root) });
      }
    },
  });
}

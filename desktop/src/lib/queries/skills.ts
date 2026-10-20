import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { SkillIndexPackage } from "~/domain/types";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

export type SkillRunInput = {
  root: string;
  id: string;
  commit: string;
  course: string;
  exportDir: string;
  confirmed: boolean;
};

export function useSkillIndex() {
  return useQuery({
    queryKey: qk.skillIndex(),
    enabled: false,
    queryFn: () => invoke<{ packages: SkillIndexPackage[] }>("skill_index"),
  });
}

export function useSkillInstallMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoke<{ commit: string }>("skill_install", { id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.skillIndex() });
      void queryClient.invalidateQueries({ queryKey: qk.settings() });
    },
  });
}

export function useSkillRunMutation() {
  return useMutation({
    mutationFn: (input: SkillRunInput) => invoke("skill_run", input),
  });
}

export function useSkillUninstallMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoke("skill_uninstall", { id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.skillIndex() });
      void queryClient.invalidateQueries({ queryKey: qk.settings() });
    },
  });
}

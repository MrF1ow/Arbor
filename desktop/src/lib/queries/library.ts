import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { DigestInfo, LibraryShowResult } from "~/domain/types";
import { canUseDesktopIpc } from "~/domain/tauri";
import { presentUpdatePlanAfterImport, suppressWatch } from "~/lib/events";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

export function fetchCourses(root: string) {
  return invoke<string[]>("list_courses", { root });
}

export function useLibrary(root: string | null) {
  return useQuery({
    queryKey: qk.library(root ?? ""),
    enabled: Boolean(root) && canUseDesktopIpc(),
    queryFn: () => invoke<LibraryShowResult>("library_show", { root: root! }),
  });
}

export function useCourses(root: string | null) {
  return useQuery({
    queryKey: qk.courses(root ?? ""),
    enabled: Boolean(root) && canUseDesktopIpc(),
    queryFn: () => fetchCourses(root!),
  });
}

export function useDigests(root: string | null, course: string | null) {
  return useQuery({
    queryKey: qk.digests(root ?? "", course ?? ""),
    enabled: Boolean(root && course) && canUseDesktopIpc(),
    queryFn: () =>
      invoke<DigestInfo[]>("list_digests", { root: root!, course: course! }),
  });
}

export function useCreateCourseMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      invoke<string>("create_course", { root: root!, name }),
    onSuccess: () => {
      if (root) {
        void queryClient.invalidateQueries({ queryKey: qk.courses(root) });
      }
    },
  });
}

export function useImportSourcesMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { course: string; paths: string[] }) => {
      suppressWatch(5000);
      return invoke<string[]>("import_sources", {
        root: root!,
        course: input.course,
        paths: input.paths,
      });
    },
    onSuccess: async (imported) => {
      if (root) {
        toast.success(`Added ${imported.length} file(s)`);
        void queryClient.invalidateQueries({ queryKey: qk.courses(root) });
        await presentUpdatePlanAfterImport(root);
      }
    },
  });
}

export function useInitKnowledgeRepoMutation() {
  return useMutation({
    mutationFn: (path: string) => invoke<boolean>("init_knowledge_repo", { path }),
  });
}

export function useInitArborDbMutation(root: string | null) {
  return useMutation({
    mutationFn: () => invoke("init_arbor_db", { root: root! }),
  });
}

export function useLibrarySetMembersMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (members: { email: string; role: string }[]) =>
      invoke("library_set_members", { root: root!, members }),
    onSuccess: () => {
      if (root) {
        void queryClient.invalidateQueries({ queryKey: qk.library(root) });
      }
    },
  });
}

export function useLibrarySetProviderMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; model: string } | { clear: true }) => {
      if ("clear" in input) {
        return invoke("library_set_provider", {
          root: root!,
          id: null,
          model: null,
          clear: true,
        });
      }
      return invoke("library_set_provider", {
        root: root!,
        id: input.id,
        model: input.model,
        clear: false,
      });
    },
    onSuccess: () => {
      if (root) {
        void queryClient.invalidateQueries({ queryKey: qk.library(root) });
        void queryClient.invalidateQueries({ queryKey: ["models", root] });
        void queryClient.invalidateQueries({ queryKey: ["models"] });
      }
    },
  });
}

export function useCreateSharedLibraryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { root: string; name: string | null }) =>
      invoke<{ name: string }>("create_shared_library", input),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: qk.settings() });
      void queryClient.invalidateQueries({ queryKey: qk.library(vars.root) });
    },
  });
}

export function useJoinLibraryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; dest: string }) =>
      invoke("join_library", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.settings() });
    },
  });
}

export function useReindexKnowledgeMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<{ documents: number }>("reindex_knowledge", { root: root! }),
    onSuccess: () => {
      if (root) {
        void queryClient.invalidateQueries({ queryKey: ["search", root] });
      }
    },
  });
}

export function useStartFolderWatchMutation() {
  return useMutation({
    mutationFn: (root: string) => invoke("start_folder_watch", { root }),
  });
}

export function useSetProviderSecretMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { providerId: string; secret: string }) =>
      invoke("set_provider_secret", input),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: qk.providerSecret(vars.providerId) });
    },
  });
}

export function useClearProviderSecretMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) => invoke("clear_provider_secret", { providerId }),
    onSuccess: (_data, providerId) => {
      void queryClient.invalidateQueries({ queryKey: qk.providerSecret(providerId) });
    },
  });
}

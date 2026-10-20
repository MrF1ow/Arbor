import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { effectiveProvider } from "~/domain/library-role";
import { useLibrary } from "~/lib/queries/library";
import { qk } from "~/lib/queries/keys";
import { useSettings } from "~/lib/queries/settings";

export function useEffectiveProvider(root: string | null) {
  const settings = useSettings();
  const library = useLibrary(root);
  const s = settings.data;
  if (!s) {
    return {
      providerId: "codex",
      modelId: null as string | null,
      source: "settings" as const,
    };
  }
  const libraryProvider =
    library.data?.present === true ? library.data.provider : null;
  return effectiveProvider({
    root,
    settingsProviderId: s.provider_id?.trim() || "codex",
    settingsModelId: s.model_id ?? null,
    overrides: s.provider_overrides ?? [],
    libraryProvider,
  });
}

let lastAppliedEffectiveKey: string | null = null;

export function resetEffectiveProviderApplyForTests() {
  lastAppliedEffectiveKey = null;
}

export function useApplyEffectiveProvider(root: string | null) {
  const effective = useEffectiveProvider(root);
  const queryClient = useQueryClient();

  useEffect(() => {
    const key = `${root ?? ""}|${effective.providerId}`;
    if (lastAppliedEffectiveKey === key) {
      return;
    }
    lastAppliedEffectiveKey = key;
    void queryClient.invalidateQueries({
      queryKey: qk.models(effective.providerId, root),
    });
  }, [effective.providerId, queryClient, root]);
}

export function EffectiveProviderSync() {
  const settings = useSettings();
  const root = settings.data?.active_root ?? settings.data?.knowledge_root ?? null;
  useApplyEffectiveProvider(root);
  return null;
}

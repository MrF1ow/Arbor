import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { effectiveProvider, type ProviderSource } from "~/domain/library-role";
import { useLibrary } from "~/lib/queries/library";
import { qk } from "~/lib/queries/keys";
import { useSettings } from "~/lib/queries/settings";

export type EffectiveProviderState = {
  providerId: string | null;
  modelId: string | null;
  source: ProviderSource | null;
  /** False until settings have loaded. Auth and model queries must stay disabled. */
  ready: boolean;
};

export function useEffectiveProvider(root: string | null): EffectiveProviderState {
  const settings = useSettings();
  const library = useLibrary(root);
  const s = settings.data;
  // A placeholder id here used to be "codex". That fired check_auth and list_models
  // for a provider the user had not chosen, and those calls landed whenever the
  // settings query happened to resolve.
  if (!s) {
    return {
      providerId: null,
      modelId: null,
      source: null,
      ready: false,
    };
  }
  const libraryProvider =
    library.data?.present === true ? library.data.provider : null;
  return {
    ...effectiveProvider({
      root,
      settingsProviderId: s.provider_id?.trim() || "codex",
      settingsModelId: s.model_id ?? null,
      overrides: s.provider_overrides ?? [],
      libraryProvider,
    }),
    ready: true,
  };
}

let lastAppliedEffectiveKey: string | null = null;

export function resetEffectiveProviderApplyForTests() {
  lastAppliedEffectiveKey = null;
}

export function useApplyEffectiveProvider(root: string | null) {
  const effective = useEffectiveProvider(root);
  const library = useLibrary(root);
  const queryClient = useQueryClient();

  const libraryProvider =
    library.data?.present === true ? library.data.provider : null;
  const librarySnapshot = libraryProvider
    ? `${libraryProvider.id}\0${libraryProvider.model ?? ""}`
    : "";

  useEffect(() => {
    if (!effective.ready || !effective.providerId) {
      return;
    }
    const providerId = effective.providerId;
    const libraryModelPart =
      effective.source === "library" ? (effective.modelId ?? "") : "";
    const key = `${root ?? ""}|${providerId}|${librarySnapshot}|${libraryModelPart}`;
    if (lastAppliedEffectiveKey === key) {
      return;
    }
    lastAppliedEffectiveKey = key;
    void queryClient.invalidateQueries({
      queryKey: qk.models(providerId, root),
    });
  }, [
    effective.modelId,
    effective.providerId,
    effective.ready,
    effective.source,
    librarySnapshot,
    queryClient,
    root,
  ]);
}

export function EffectiveProviderSync() {
  const settings = useSettings();
  const root = settings.data?.active_root ?? settings.data?.knowledge_root ?? null;
  useApplyEffectiveProvider(root);
  return null;
}

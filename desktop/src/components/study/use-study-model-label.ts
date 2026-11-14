import { PROVIDER_FALLBACK } from "~/domain/provider";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useEffectiveProvider } from "~/lib/queries/effective-provider";
import { useSettings } from "~/lib/queries/settings";

/** "Codex · gpt-5.5": the provider and model a generation from this view would use; null until both are set. */
export function useStudyModelLabel(): string | null {
  const settings = useSettings();
  const effective = useEffectiveProvider(pickActiveRoot(settings.data));
  const model = effective.modelId?.trim();
  if (!effective.providerId || !model) {
    return null;
  }
  const label = PROVIDER_FALLBACK.find((p) => p.id === effective.providerId)?.label ?? effective.providerId;
  return `${label} · ${model}`;
}

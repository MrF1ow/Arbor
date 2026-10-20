import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { SettingRow, SettingsSection } from "~/components/app/settings-section";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  LIBRARY_RECOMMENDATION_LABEL,
  upsertProviderOverride,
} from "~/domain/library-role";
import {
  PROVIDER_FALLBACK,
  isWorkerUnavailableAuthReason,
  providerBadge,
} from "~/domain/provider";
import type { Model } from "~/domain/types";
import { fetchAuthStatus } from "~/lib/auth-refresh";
import { invoke } from "~/lib/ipc";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useAuth, useProviderSecretStatus } from "~/lib/queries/auth";
import { useEffectiveProvider } from "~/lib/queries/effective-provider";
import { qk } from "~/lib/queries/keys";
import { useLibrary } from "~/lib/queries/library";
import {
  useClearProviderSecretMutation,
  useSetProviderSecretMutation,
} from "~/lib/queries/library";
import { usePersistSettingsMutation, useSettings } from "~/lib/queries/settings";
import { useModels, useProviderOptions, useRefreshModels } from "~/lib/queries/workers";
import { cn } from "~/lib/utils";
import { useJobStore } from "~/stores/job-store";

function resolveModelId(models: Model[], preferred: string | null): string | null {
  if (models.length === 0) {
    return null;
  }
  if (preferred && models.some((m) => m.id === preferred)) {
    return preferred;
  }
  return models[0]?.id ?? null;
}

function ProviderAuthStatus({
  providerId,
  modelId,
}: {
  providerId: string;
  modelId: string | null;
}) {
  const auth = useAuth(providerId);
  const providerLabel = PROVIDER_FALLBACK.find((p) => p.id === providerId)?.label ?? providerId;
  const modelLabel = modelId ?? "no model";

  let text: string;
  let dotClass = "bg-primary";
  if (auth.isLoading) {
    text = `${providerLabel} · checking…`;
    dotClass = "bg-muted-foreground";
  } else if (auth.data?.authenticated) {
    text = `${providerLabel} · ${modelLabel}`;
  } else {
    text = providerBadge(providerLabel, modelLabel, false, auth.data?.reason);
    if (auth.data?.reason && isWorkerUnavailableAuthReason(auth.data.reason)) {
      dotClass = "bg-destructive";
    } else {
      dotClass = "bg-muted-foreground";
    }
  }

  const docsUrl = auth.data?.docs_url?.trim();
  const showDocs = !auth.isLoading && auth.data && !auth.data.authenticated && docsUrl;

  return (
    <div className="space-y-1 px-4 py-3 text-sm text-muted-foreground" data-testid="provider-auth-status">
      <div className="flex items-center gap-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", dotClass)} aria-hidden />
        <span>{text}</span>
      </div>
      {showDocs ? (
        <a
          href={docsUrl}
          className="text-xs text-primary underline-offset-2 hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          Set up {providerLabel}
        </a>
      ) : null}
    </div>
  );
}

export function SettingsProviderPanel() {
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const library = useLibrary(activeRoot);
  const libraryProvider =
    library.data?.present === true && library.data.provider ? library.data.provider : null;
  const effective = useEffectiveProvider(activeRoot);
  const providerOptions = useProviderOptions();
  const providerId = effective.providerId;
  const modelsQuery = useModels(providerId, activeRoot);
  const refreshModels = useRefreshModels();
  const persistSettings = usePersistSettingsMutation();
  const queryClient = useQueryClient();
  const appendLog = useJobStore((s) => s.append);

  const secretStatus = useProviderSecretStatus(providerId);
  const setSecret = useSetProviderSecretMutation();
  const clearSecret = useClearProviderSecretMutation();
  const [apiKey, setApiKey] = useState("");
  const programmatic = useRef(false);

  const librarySettled = !library.isLoading && library.isFetched;
  const showKeyRow = providerId === "openai_api" || providerId === "anthropic_api";
  const showBaseUrlRow = providerId === "ollama" || providerId === "lmstudio";
  const baseUrlPlaceholder =
    providerId === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234/v1";

  const storedBaseUrl =
    providerId === "ollama"
      ? (settings.data?.ollama_base_url?.trim() ?? "")
      : providerId === "lmstudio"
        ? (settings.data?.lmstudio_base_url?.trim() ?? "")
        : "";

  const persistProviderModel = useCallback(
    async (nextProviderId: string, nextModelId: string | null) => {
      await persistSettings.mutateAsync((current) => {
        if (activeRoot && libraryProvider) {
          return {
            ...current,
            provider_overrides: upsertProviderOverride(
              current.provider_overrides ?? [],
              activeRoot,
              nextProviderId,
              nextModelId,
            ),
          };
        }
        return {
          ...current,
          provider_id: nextProviderId,
          model_id: nextModelId,
        };
      });
    },
    [activeRoot, libraryProvider, persistSettings],
  );

  const storeForcedAuth = async (targetProviderId: string) => {
    const auth = await fetchAuthStatus(targetProviderId, true);
    queryClient.setQueryData(qk.auth(targetProviderId), auth);
  };

  const onProviderChange = async (nextProviderId: string) => {
    if (!librarySettled || nextProviderId === providerId) {
      return;
    }
    const prevModel = effective.modelId;
    programmatic.current = true;
    try {
      let models: Model[];
      try {
        models = await queryClient.fetchQuery({
          queryKey: qk.models(nextProviderId, activeRoot),
          queryFn: async () => {
            const res = await invoke<{ models: Model[] }>("list_models", {
              root: activeRoot ?? undefined,
              provider: nextProviderId,
            });
            return res.models;
          },
        });
      } catch (modelsError) {
        toast.error(String(modelsError));
        await persistProviderModel(nextProviderId, prevModel);
        await storeForcedAuth(nextProviderId);
        return;
      }
      const nextModelId = resolveModelId(models, prevModel);
      await persistProviderModel(nextProviderId, nextModelId);
      await storeForcedAuth(nextProviderId);
    } catch (error) {
      toast.error(String(error));
    } finally {
      programmatic.current = false;
    }
  };

  const onModelChange = async (nextModelId: string) => {
    if (!librarySettled || programmatic.current) {
      return;
    }
    try {
      await persistProviderModel(providerId, nextModelId || null);
      await fetchAuthStatus(providerId, false);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const onBaseUrlCommit = async (value: string) => {
    const trimmed = value.trim();
    if (trimmed === storedBaseUrl) {
      return;
    }
    try {
      await persistSettings.mutateAsync((current) => {
        if (providerId === "ollama") {
          return { ...current, ollama_base_url: trimmed || null };
        }
        if (providerId === "lmstudio") {
          return { ...current, lmstudio_base_url: trimmed || null };
        }
        return current;
      });
      refreshModels(providerId, activeRoot);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const onSaveKey = async () => {
    try {
      await setSecret.mutateAsync({ providerId, secret: apiKey });
      setApiKey("");
      await storeForcedAuth(providerId);
    } catch (error) {
      const message = `Could not save API key: ${error}`;
      appendLog(message);
      toast.error(message);
    }
  };

  const onClearKey = async () => {
    try {
      await clearSecret.mutateAsync(providerId);
      setApiKey("");
      await storeForcedAuth(providerId);
    } catch (error) {
      const message = `Could not clear API key: ${error}`;
      appendLog(message);
      toast.error(message);
    }
  };

  const models = modelsQuery.data ?? [];
  const selectModelId = resolveModelId(models, effective.modelId) ?? "";

  useEffect(() => {
    const loaded = modelsQuery.data ?? [];
    if (programmatic.current || modelsQuery.isLoading || loaded.length === 0) {
      return;
    }
    const resolved = resolveModelId(loaded, effective.modelId);
    if (!resolved || resolved === effective.modelId) {
      return;
    }
    programmatic.current = true;
    void persistProviderModel(providerId, resolved).finally(() => {
      programmatic.current = false;
    });
  }, [effective.modelId, modelsQuery.data, modelsQuery.isLoading, persistProviderModel, providerId]);

  return (
    <div className="space-y-6" data-testid="settings-provider">
      <SettingsSection title="Provider & models">
        <SettingRow
          label="Provider"
          control={
            <Select
              value={providerId}
              items={providerOptions.map((p) => ({ value: p.id, label: p.label }))}
              onValueChange={(v) => {
                if (v) {
                  void onProviderChange(v);
                }
              }}
              disabled={!librarySettled}
            >
              <SelectTrigger className="w-44" size="sm" aria-label="Provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        {effective.source === "library" ? (
          <p className="px-4 py-2 text-xs text-faint-foreground">{LIBRARY_RECOMMENDATION_LABEL}</p>
        ) : null}
        {showKeyRow ? (
          <SettingRow
            label="API key"
            controlId="settings-provider-api-key"
            control={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Input
                  id="settings-provider-api-key"
                  type="password"
                  autoComplete="off"
                  className="w-40"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  data-testid="provider-api-key"
                />
                <Button variant="secondary" size="sm" disabled={setSecret.isPending} onClick={() => void onSaveKey()}>
                  Save key
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={clearSecret.isPending}
                  onClick={() => void onClearKey()}
                >
                  Clear key
                </Button>
              </div>
            }
          />
        ) : null}
        {showKeyRow && secretStatus.isSuccess ? (
          <div className="px-4 pb-3 text-xs text-muted-foreground" data-testid="provider-key-status">
            {secretStatus.data === "ready" ? "ready" : "key missing"}
          </div>
        ) : null}
        {showBaseUrlRow ? (
          <SettingRow
            label="Base URL"
            control={
              <Input
                key={`${providerId}-${storedBaseUrl}`}
                type="text"
                autoComplete="off"
                className="w-56"
                placeholder={baseUrlPlaceholder}
                defaultValue={storedBaseUrl}
                onBlur={(e) => void onBaseUrlCommit(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void onBaseUrlCommit(e.currentTarget.value);
                  }
                }}
                data-testid="provider-base-url"
              />
            }
          />
        ) : null}
        <SettingRow
          label="Model"
          controlId="settings-provider-model"
          control={
            <div className="flex items-center gap-2">
              <Select
                value={selectModelId}
                items={models.map((m) => ({ value: m.id, label: m.label }))}
                onValueChange={(v) => {
                  if (v) {
                    void onModelChange(v);
                  }
                }}
                disabled={!librarySettled || modelsQuery.isLoading || models.length === 0}
              >
                <SelectTrigger
                  id="settings-provider-model"
                  className="w-44"
                  size="sm"
                  aria-label="Model"
                >
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh models"
                disabled={modelsQuery.isFetching}
                onClick={() => refreshModels(providerId, activeRoot)}
              >
                <RefreshCw className={cn("size-icon-sm", modelsQuery.isFetching && "animate-spin")} />
              </Button>
            </div>
          }
        />
        <ProviderAuthStatus providerId={providerId} modelId={selectModelId || effective.modelId} />
      </SettingsSection>
    </div>
  );
}

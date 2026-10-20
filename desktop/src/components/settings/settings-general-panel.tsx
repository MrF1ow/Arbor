import { FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { SettingRow, SettingsSection } from "~/components/app/settings-section";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import type { Appearance } from "~/domain/types";
import { useChooseKnowledgeFolder } from "~/lib/hooks/use-choose-knowledge-folder";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useReindexKnowledgeMutation } from "~/lib/queries/library";
import {
  useKnowledgeSettings,
  useSaveKnowledgeSettingsMutation,
  useSettings,
  type KnowledgeSettingsPartial,
} from "~/lib/queries/settings";
import { qk } from "~/lib/queries/keys";
import { useQueryClient } from "@tanstack/react-query";
import { useUiStore } from "~/stores/ui-store";
import { useJobStore } from "~/stores/job-store";
import { EmptyState } from "~/components/app/empty-state";
import { Skeleton } from "~/components/ui/skeleton";

const APPEARANCE_OPTIONS: { value: Appearance; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function SettingsGeneralPanel() {
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const knowledge = useKnowledgeSettings(activeRoot);
  const saveKnowledge = useSaveKnowledgeSettingsMutation(activeRoot);
  const reindex = useReindexKnowledgeMutation(activeRoot);
  const queryClient = useQueryClient();
  const appearance = useUiStore((s) => s.appearance);
  const setAppearance = useUiStore((s) => s.setAppearance);
  const { chooseFolder, isPending: choosingFolder } = useChooseKnowledgeFolder();
  const appendLog = useJobStore((s) => s.append);

  const onKnowledgeToggle = async (partial: KnowledgeSettingsPartial) => {
    if (!activeRoot || !knowledge.data) {
      return;
    }
    const previous = knowledge.data;
    const optimistic = {
      ...previous,
      ...partial,
      auto_generate: {
        ...previous.auto_generate,
        ...(partial.auto_generate ?? {}),
      },
    };
    queryClient.setQueryData(qk.knowledgeSettings(activeRoot), optimistic);
    try {
      await saveKnowledge.mutateAsync(partial);
    } catch (error) {
      queryClient.setQueryData(qk.knowledgeSettings(activeRoot), previous);
      toast.error(String(error));
    }
  };

  const onReindex = async () => {
    if (!activeRoot) {
      return;
    }
    try {
      const result = await reindex.mutateAsync();
      const message = `Reindexed ${result.documents} document(s).`;
      toast.success(message);
      appendLog(message);
    } catch (error) {
      const message = `Reindex failed: ${error}`;
      appendLog(message);
      toast.error(message);
    }
  };

  return (
    <div className="space-y-6" data-testid="settings-general">
      <SettingsSection title="Appearance">
        <SettingRow
          label="Appearance"
          control={
            <Select
              value={appearance}
              items={APPEARANCE_OPTIONS}
              onValueChange={(v) => setAppearance(v as Appearance)}
            >
              <SelectTrigger className="w-36" size="sm" aria-label="Appearance">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPEARANCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection title="Knowledge folder">
        {!settings.data ? (
          <div className="p-4">
            <Skeleton className="h-48 w-full" />
          </div>
        ) : !activeRoot ? (
          <div className="p-4">
            <EmptyState
              icon={FolderOpen}
              title="Choose a Knowledge folder first"
              actions={
                <Button variant="default" disabled={choosingFolder} onClick={() => void chooseFolder()}>
                  Choose Knowledge folder…
                </Button>
              }
            />
          </div>
        ) : knowledge.isLoading && !knowledge.data ? (
          <div className="p-4">
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <>
            <SettingRow
              label="Watch folder for new files"
              control={
                <Switch
                  checked={knowledge.data?.watch_enabled ?? false}
                  disabled={saveKnowledge.isPending}
                  onCheckedChange={(checked) => void onKnowledgeToggle({ watch_enabled: checked })}
                />
              }
            />
            <SettingRow
              label="Auto-run after watch"
              control={
                <Switch
                  checked={knowledge.data?.auto_update ?? false}
                  disabled={saveKnowledge.isPending}
                  onCheckedChange={(checked) => void onKnowledgeToggle({ auto_update: checked })}
                />
              }
            />
            <SettingRow
              label="Embed after Update"
              control={
                <Switch
                  checked={knowledge.data?.auto_embed ?? false}
                  disabled={saveKnowledge.isPending}
                  onCheckedChange={(checked) => void onKnowledgeToggle({ auto_embed: checked })}
                />
              }
            />
            <SettingRow
              label="Delete sources after digest"
              control={
                <Switch
                  checked={knowledge.data?.delete_sources_after_digest ?? false}
                  disabled={saveKnowledge.isPending}
                  onCheckedChange={(checked) =>
                    void onKnowledgeToggle({ delete_sources_after_digest: checked })
                  }
                />
              }
            />
            <SettingRow
              label="Auto-generate flashcards after Update"
              control={
                <Switch
                  checked={knowledge.data?.auto_generate.flashcards ?? false}
                  disabled={saveKnowledge.isPending}
                  onCheckedChange={(checked) =>
                    void onKnowledgeToggle({ auto_generate: { flashcards: checked } })
                  }
                />
              }
            />
            <SettingRow
              label="Auto-generate quiz after Update"
              control={
                <Switch
                  checked={knowledge.data?.auto_generate.quiz ?? false}
                  disabled={saveKnowledge.isPending}
                  onCheckedChange={(checked) =>
                    void onKnowledgeToggle({ auto_generate: { quiz: checked } })
                  }
                />
              }
            />
            <SettingRow
              label="Search index"
              control={
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={reindex.isPending}
                  data-testid="reindex-knowledge"
                  onClick={() => void onReindex()}
                >
                  {reindex.isPending ? (
                    <Loader2 className="size-icon-sm animate-spin" aria-hidden />
                  ) : null}
                  Reindex
                </Button>
              }
            />
          </>
        )}
      </SettingsSection>
    </div>
  );
}

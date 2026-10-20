import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "~/components/app/empty-state";
import { SettingRow, SettingsSection } from "~/components/app/settings-section";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { useChooseKnowledgeFolder } from "~/lib/hooks/use-choose-knowledge-folder";
import { pickActiveRoot } from "~/lib/knowledge-root";
import {
  useKnowledgeSettings,
  useSaveKnowledgeSettingsMutation,
  useSettings,
} from "~/lib/queries/settings";
import {
  useSyncNowMutation,
  useSyncSetRemoteMutation,
  useSyncSetSharedMutation,
  useSyncState,
} from "~/lib/queries/sync";
import { useSyncUiStore } from "~/stores/sync-ui-store";
import { FolderOpen } from "lucide-react";

export function SettingsSyncPanel() {
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const sync = useSyncState(activeRoot);
  const knowledge = useKnowledgeSettings(activeRoot);
  const saveKnowledge = useSaveKnowledgeSettingsMutation(activeRoot);
  const setRemote = useSyncSetRemoteMutation(activeRoot);
  const setShared = useSyncSetSharedMutation(activeRoot);
  const syncNow = useSyncNowMutation(activeRoot);
  const { chooseFolder, isPending: choosingFolder } = useChooseKnowledgeFolder();

  const [remoteDraft, setRemoteDraft] = useState("");
  const [statusLine, setStatusLine] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror sync_show remote into the input
    setRemoteDraft(sync.data?.remote ?? "");
  }, [sync.data?.remote]);

  if (!settings.data) {
    return null;
  }

  if (!activeRoot) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="Choose a knowledge folder"
        description="Pick a folder before configuring sync."
        actions={
          <Button type="button" disabled={choosingFolder} onClick={() => void chooseFolder()}>
            Choose
          </Button>
        }
      />
    );
  }

  const onSaveRemote = async () => {
    const url = remoteDraft.trim();
    if (!url) {
      setStatusLine("Enter a remote URL.");
      return;
    }
    setStatusLine("");
    try {
      const result = await setRemote.mutateAsync(url);
      setRemoteDraft(result.remote);
      setStatusLine("Remote saved.");
    } catch (error) {
      setStatusLine(String(error));
      toast.error(String(error));
    }
  };

  const onSyncNow = async () => {
    setStatusLine("");
    try {
      const result = await syncNow.mutateAsync();
      if (!result.ok && result.action === "conflict") {
        useSyncUiStore.getState().setSyncConflictOpen(true);
        return;
      }
      if (result.ok) {
        setStatusLine(`Synced (${result.action}).`);
      }
    } catch (error) {
      setStatusLine(String(error));
      toast.error(String(error));
    }
  };

  const onSharedChange = async (checked: boolean) => {
    try {
      await setShared.mutateAsync(checked);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const onSyncAfterCommit = async (checked: boolean) => {
    if (!knowledge.data) {
      return;
    }
    try {
      await saveKnowledge.mutateAsync({ sync_after_commit: checked });
    } catch (error) {
      toast.error(String(error));
    }
  };

  return (
    <div className="space-y-6" data-testid="settings-sync">
      <SettingsSection title="Sync">
        <SettingRow
          label="Arbor remote"
          control={
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Arbor remote"
                value={remoteDraft}
                onChange={(e) => setRemoteDraft(e.target.value)}
                placeholder="git@host:repo.git"
                className="w-56"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={setRemote.isPending}
                onClick={() => void onSaveRemote()}
              >
                Save remote
              </Button>
            </div>
          }
        />
        {sync.data?.remote_note ? (
          <p className="px-4 pb-3 text-sm text-muted-foreground" data-testid="sync-remote-note">
            {sync.data.remote_note}
          </p>
        ) : null}
        <SettingRow
          label="Shared library (merge on sync)"
          control={
            <Switch
              aria-label="Shared library (merge on sync)"
              checked={Boolean(sync.data?.shared)}
              onCheckedChange={(checked) => void onSharedChange(checked)}
            />
          }
        />
        <SettingRow
          label="Sync after each committed job"
          control={
            <Switch
              aria-label="Sync after each committed job"
              checked={Boolean(knowledge.data?.sync_after_commit)}
              onCheckedChange={(checked) => void onSyncAfterCommit(checked)}
            />
          }
        />
        <SettingRow
          label="Manual sync"
          control={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={syncNow.isPending}
              onClick={() => void onSyncNow()}
            >
              {syncNow.isPending ? (
                <>
                  <Loader2 className="size-icon-sm animate-spin" aria-hidden />
                  Sync now
                </>
              ) : (
                "Sync now"
              )}
            </Button>
          }
        />
        {statusLine ? (
          <p className="px-4 pb-3 text-sm text-muted-foreground" data-testid="sync-status">
            {statusLine}
          </p>
        ) : null}
      </SettingsSection>
    </div>
  );
}

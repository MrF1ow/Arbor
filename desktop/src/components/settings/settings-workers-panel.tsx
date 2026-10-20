import { useState } from "react";

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
  fillWorkerFormFields,
  generateWorkerId,
  knowledgeRootLabel,
  workerListLabel,
  readWorkerFromForm,
  removeWorkerFromSettings,
  setRootWorkerOnSettings,
  upsertWorker,
} from "~/domain/workers-persist";
import type { SshWorker } from "~/domain/types";
import { useTestWorkerConnectionMutation } from "~/lib/queries/jobs";
import { usePersistSettingsMutation, useSettings } from "~/lib/queries/settings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";

/** Select value for "run locally"; Base UI treats "" as no selection. */
const LOCAL_WORKER_VALUE = "local";

const emptyForm = {
  label: "",
  host: "",
  portRaw: "",
  user: "",
  identityFile: "",
  workerCmd: "",
  remoteRoot: "",
};

export function SettingsWorkersPanel() {
  const settings = useSettings();
  const persistSettings = usePersistSettingsMutation();
  const testConnection = useTestWorkerConnectionMutation();

  const workers = settings.data?.workers ?? [];
  const roots = settings.data?.knowledge_roots ?? [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [statusLine, setStatusLine] = useState("");
  const [removeTarget, setRemoveTarget] = useState<SshWorker | null>(null);

  const saveLabel = editingId ? "Save worker" : "Add worker";

  const onSaveWorker = async () => {
    if (editingId && !workers.some((w) => w.id === editingId)) {
      setStatusLine("Worker not found.");
      return;
    }
    const id = editingId ?? generateWorkerId();
    const parsed = readWorkerFromForm({
      forId: id,
      label: form.label,
      host: form.host,
      portRaw: form.portRaw,
      user: form.user,
      identityFile: form.identityFile,
      workerCmd: form.workerCmd,
      remoteRoot: form.remoteRoot,
    });
    if (!parsed.ok) {
      setStatusLine(parsed.message);
      return;
    }
    try {
      await persistSettings.mutateAsync((current) => ({
        ...current,
        workers: upsertWorker(current.workers ?? [], parsed.worker, editingId),
      }));
      setStatusLine("Saved.");
      setEditingId(null);
      setForm(emptyForm);
    } catch (error) {
      setStatusLine(String(error));
    }
  };

  const onTestConnection = async () => {
    const id = editingId ?? "preview";
    const parsed = readWorkerFromForm({
      forId: id,
      label: form.label,
      host: form.host,
      portRaw: form.portRaw,
      user: form.user,
      identityFile: form.identityFile,
      workerCmd: form.workerCmd,
      remoteRoot: form.remoteRoot,
    });
    if (!parsed.ok) {
      setStatusLine(parsed.message);
      return;
    }
    try {
      const version = await testConnection.mutateAsync(parsed.worker);
      setStatusLine(version);
    } catch (error) {
      setStatusLine(String(error));
    }
  };

  const onRemoveWorker = async (worker: SshWorker) => {
    try {
      await persistSettings.mutateAsync((current) => removeWorkerFromSettings(current, worker.id));
      setStatusLine("Removed.");
      if (editingId === worker.id) {
        setEditingId(null);
        setForm(emptyForm);
      }
      setRemoveTarget(null);
    } catch (error) {
      setStatusLine(String(error));
    }
  };

  const onRootWorkerChange = async (entryPath: string, workerId: string) => {
    const nextId = workerId.trim() || null;
    try {
      await persistSettings.mutateAsync((current) =>
        setRootWorkerOnSettings(current, entryPath, nextId),
      );
      setStatusLine("Saved.");
    } catch (error) {
      setStatusLine(String(error));
    }
  };

  return (
    <div className="space-y-6" data-testid="settings-workers">
      <SettingsSection title="Workers">
        {workers.map((worker) => (
          <SettingRow
            key={worker.id}
            label={workerListLabel(worker)}
            control={
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setEditingId(worker.id);
                    setForm(fillWorkerFormFields(worker));
                    setStatusLine("");
                  }}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setRemoveTarget(worker)}
                >
                  Remove
                </Button>
              </div>
            }
          />
        ))}

        <SettingRow
          label="Label"
          control={
            <Input
              aria-label="Worker label"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          }
        />
        <SettingRow
          label="Host"
          control={
            <Input
              aria-label="Worker host"
              value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
            />
          }
        />
        <SettingRow
          label="Port"
          control={
            <Input
              aria-label="Worker port"
              value={form.portRaw}
              onChange={(e) => setForm((f) => ({ ...f, portRaw: e.target.value }))}
              placeholder="22"
            />
          }
        />
        <SettingRow
          label="User"
          control={
            <Input
              aria-label="Worker user"
              value={form.user}
              onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
            />
          }
        />
        <SettingRow
          label="Identity file"
          control={
            <Input
              aria-label="Identity file"
              value={form.identityFile}
              onChange={(e) => setForm((f) => ({ ...f, identityFile: e.target.value }))}
              placeholder="/absolute/path/to/key"
            />
          }
        />
        <SettingRow
          label="Worker command"
          control={
            <Input
              aria-label="Worker command"
              value={form.workerCmd}
              onChange={(e) => setForm((f) => ({ ...f, workerCmd: e.target.value }))}
              placeholder="uv run --project /path/to/python arbor-worker"
            />
          }
        />
        <SettingRow
          label="Remote root"
          control={
            <Input
              aria-label="Remote root"
              value={form.remoteRoot}
              onChange={(e) => setForm((f) => ({ ...f, remoteRoot: e.target.value }))}
            />
          }
        />
        <SettingRow
          label="Worker"
          control={
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => void onSaveWorker()}>
                {saveLabel}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => void onTestConnection()}>
                Test connection
              </Button>
            </div>
          }
        />
        {statusLine ? (
          <p className="px-4 pb-3 text-sm text-muted-foreground" data-testid="worker-status">
            {statusLine}
          </p>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Per-root worker">
        {roots.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Add a knowledge folder to choose a worker.</p>
        ) : (
          roots.map((entry) => {
            const workerItems = [
              { value: LOCAL_WORKER_VALUE, label: "Local" },
              ...workers.map((w) => ({ value: w.id, label: w.label })),
            ];
            return (
              <SettingRow
                key={entry.path}
                label={knowledgeRootLabel(entry)}
                control={
                  <Select
                    value={entry.worker_id || LOCAL_WORKER_VALUE}
                    items={workerItems}
                    onValueChange={(value) =>
                      void onRootWorkerChange(
                        entry.path,
                        !value || value === LOCAL_WORKER_VALUE ? "" : value,
                      )
                    }
                  >
                    <SelectTrigger className="w-36" size="sm" aria-label={`Worker for ${entry.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {workerItems.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            );
          })
        )}
      </SettingsSection>

      <AlertDialog open={removeTarget != null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove worker?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove {removeTarget?.label ?? "this worker"} and clear any root assignments.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeTarget && void onRemoveWorker(removeTarget)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

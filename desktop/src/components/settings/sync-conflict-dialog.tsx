import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ListRow } from "~/components/app/list-row";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import type { SyncConflictFile } from "~/domain/types";
import { reloadLibraryAfterSync } from "~/lib/library-reload";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useSettings } from "~/lib/queries/settings";
import {
  useSyncConflict,
  useSyncContinueMutation,
  useSyncResolveMutation,
} from "~/lib/queries/sync";
import { useSyncUiStore } from "~/stores/sync-ui-store";
import { useUiStore } from "~/stores/ui-store";
import { cn } from "~/lib/utils";

function isConflictResolved(entry: SyncConflictFile): boolean {
  return entry.choice === "mine" || entry.choice === "theirs" || entry.choice === "edit";
}

function pickFocusPath(
  files: SyncConflictFile[],
  current: string | null,
  afterResolvedPath: string | null = null,
): string | null {
  if (files.length === 0) {
    return null;
  }
  if (afterResolvedPath) {
    const idx = files.findIndex((f) => f.path === afterResolvedPath);
    if (idx >= 0) {
      for (let offset = 1; offset <= files.length; offset += 1) {
        const entry = files[(idx + offset) % files.length]!;
        if (!isConflictResolved(entry)) {
          return entry.path;
        }
      }
    }
  }
  if (current && files.some((f) => f.path === current && !isConflictResolved(f))) {
    return current;
  }
  return files.find((f) => !isConflictResolved(f))?.path ?? files[0]?.path ?? null;
}

function ConflictFileDetail({
  entry,
  editDraft,
  onEditDraftChange,
  onUseMine,
  onUseTheirs,
  onUseEdit,
  busy,
}: {
  entry: SyncConflictFile;
  editDraft: string;
  onEditDraftChange: (value: string) => void;
  onUseMine: () => void;
  onUseTheirs: () => void;
  onUseEdit: () => void;
  busy: boolean;
}) {
  if (entry.binary) {
    return (
      <div data-testid="sync-conflict-binary">
        <p className="text-sm text-muted-foreground">Arbor does not resolve binary conflicts.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onUseMine}>
            Use mine
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onUseTheirs}>
            Use theirs
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="sync-conflict-text">
      <div className="grid gap-3 jobs:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Mine</span>
          <pre className="max-h-40 overflow-auto rounded-xs border border-border bg-muted p-2 font-mono text-2xs">
            {entry.mine ?? ""}
          </pre>
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Theirs</span>
          <pre className="max-h-40 overflow-auto rounded-xs border border-border bg-muted p-2 font-mono text-2xs">
            {entry.theirs ?? ""}
          </pre>
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Resolved text</span>
        <Textarea
          aria-label="Resolved text"
          rows={8}
          value={editDraft}
          onChange={(e) => onEditDraftChange(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onUseMine}>
          Use mine
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onUseTheirs}>
          Use theirs
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onUseEdit}>
          Use this text
        </Button>
      </div>
    </div>
  );
}

export function SyncConflictDialogHost() {
  const open = useSyncUiStore((s) => s.syncConflictOpen);
  const setOpen = useSyncUiStore((s) => s.setSyncConflictOpen);
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const conflict = useSyncConflict(activeRoot);
  const resolve = useSyncResolveMutation(activeRoot);
  const syncContinue = useSyncContinueMutation(activeRoot);
  const queryClient = useQueryClient();

  const files = conflict.data?.files ?? [];
  const filesVersion = files.map((f) => `${f.path}:${f.choice ?? ""}`).join("|");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [focusAfterResolve, setFocusAfterResolve] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || files.length === 0) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- focus next unresolved file after reload
    setSelectedPath((current) => pickFocusPath(files, current, focusAfterResolve));
    setFocusAfterResolve(null);
    // filesVersion tracks conflict file content; `files` is read from the same render
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filesVersion tracks files content
  }, [filesVersion, focusAfterResolve, open]);

  const activeFile = files.find((f) => f.path === selectedPath) ?? files[0];

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- sync draft when the selected conflict file changes */
    if (!activeFile || activeFile.binary) {
      setEditDraft("");
      return;
    }
    const draft =
      activeFile.choice === "edit" && activeFile.edit_content != null
        ? activeFile.edit_content
        : (activeFile.mine ?? "");
    setEditDraft(draft);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [activeFile]);

  const onResolve = async (payload: Record<string, unknown>) => {
    if (!activeRoot || !selectedPath) {
      return;
    }
    setError("");
    try {
      await resolve.mutateAsync({ path: selectedPath, ...payload });
      setFocusAfterResolve(selectedPath);
    } catch (err) {
      setError(String(err));
    }
  };

  const onContinue = async () => {
    if (!activeRoot) {
      return;
    }
    setError("");
    try {
      const result = await syncContinue.mutateAsync();
      if (!result.ok && result.action === "conflict") {
        return;
      }
      if (result.ok) {
        setOpen(false);
        toast.success("Synced (integrated).");
        const lastCourse = useUiStore.getState().lastCourse;
        const course =
          lastCourse && lastCourse.root === activeRoot ? lastCourse.course : null;
        reloadLibraryAfterSync(queryClient, activeRoot, course);
      }
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl gap-4" data-testid="sync-conflict-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-title">Sync conflict</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 jobs:min-h-64 jobs:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="max-h-80 overflow-auto rounded-xs border border-border">
            {files.map((file) => {
              const resolved = isConflictResolved(file);
              return (
                <ListRow
                  key={file.path}
                  title={resolved ? `${file.path} (resolved)` : file.path}
                  active={file.path === selectedPath}
                  className={cn(resolved && "text-muted-foreground")}
                  onSelect={() => setSelectedPath(file.path)}
                />
              );
            })}
          </div>
          <div className="min-w-0">
            {activeFile ? (
              <ConflictFileDetail
                entry={activeFile}
                editDraft={editDraft}
                onEditDraftChange={setEditDraft}
                busy={resolve.isPending}
                onUseMine={() => void onResolve({ side: "mine" })}
                onUseTheirs={() => void onResolve({ side: "theirs" })}
                onUseEdit={() => void onResolve({ side: "edit", content: editDraft })}
              />
            ) : null}
          </div>
        </div>
        {error ? (
          <p className="text-sm text-destructive" data-testid="sync-conflict-error">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button type="button" disabled={syncContinue.isPending} onClick={() => void onContinue()}>
            Continue sync
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { openDialog } from "~/lib/ipc";

export function LibraryJoinDialog({
  open,
  onOpenChange,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onConfirm: (url: string, dest: string) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [dest, setDest] = useState("");
  const [error, setError] = useState("");

  const pickFolder = async () => {
    setError("");
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked === "string") {
        setDest(picked);
      }
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError("");
          setUrl("");
          setDest("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-serif text-title">Join a library</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Library URL</span>
            <Input
              aria-label="Library URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="git@host:repo.git"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Folder</span>
            <Input aria-label="Folder" value={dest} readOnly />
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={() => void pickFolder()}>
            Choose folder…
          </Button>
        </div>
        {error ? (
          <p className="text-sm text-destructive" data-testid="library-join-error">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              const trimmedUrl = url.trim();
              const trimmedDest = dest.trim();
              if (!trimmedUrl || !trimmedDest) {
                setError("Enter a URL and choose a folder.");
                return;
              }
              setError("");
              void onConfirm(trimmedUrl, trimmedDest).catch((err) => {
                setError(String(err));
              });
            }}
          >
            Join
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

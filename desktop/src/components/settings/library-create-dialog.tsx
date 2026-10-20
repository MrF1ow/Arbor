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

export function LibraryCreateDialog({
  open,
  onOpenChange,
  defaultName,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName: string;
  busy: boolean;
  onConfirm: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-serif text-title">Create shared library</DialogTitle>
        </DialogHeader>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Name</span>
          <Input
            aria-label="Library name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {error ? (
          <p className="text-sm text-destructive" data-testid="library-create-error">
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
              setError("");
              void onConfirm(name).catch((err) => {
                setError(String(err));
              });
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

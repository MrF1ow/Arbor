import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";

export function MakeCardDialog({
  open,
  onOpenChange,
  initialText,
  citation,
  disabled,
  onSave,
  saving,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialText: string;
  citation: string;
  disabled: boolean;
  onSave: (front: string, back: string) => void;
  saving: boolean;
  error: string | null;
}) {
  const [front, setFront] = useState(initialText);
  const [back, setBack] = useState(initialText);
  const [validationError, setValidationError] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-title">Make card</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Front</span>
            <Textarea
              aria-label="Front"
              value={front}
              onChange={(e) => setFront(e.target.value)}
              rows={4}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Back</span>
            <Textarea
              aria-label="Back"
              value={back}
              onChange={(e) => setBack(e.target.value)}
              rows={4}
            />
          </label>
          {citation ? (
            <p className="text-2xs text-faint-foreground">{citation}</p>
          ) : null}
          {validationError ? (
            <p className="text-sm text-destructive">{validationError}</p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={disabled || saving}
            onClick={() => {
              const trimmedFront = front.trim();
              const trimmedBack = back.trim();
              if (!trimmedFront || !trimmedBack) {
                setValidationError("Front and back are required.");
                return;
              }
              setValidationError(null);
              onSave(trimmedFront, trimmedBack);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

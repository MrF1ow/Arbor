import { Search } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

export function SearchPlaceholderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-4">
        <DialogHeader>
          <DialogTitle>Search</DialogTitle>
          <DialogDescription>Command palette ships in PR 12.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Search className="size-icon-sm text-muted-foreground" aria-hidden />
          <Input placeholder="Search arrives in PR 12…" aria-label="Search" autoFocus />
        </div>
        <Button variant="outline" size="sm" className="self-end" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}

import { Chip } from "~/components/app/chip";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type { SkillIndexPackage } from "~/domain/types";

export function SkillPermissionsDialog({
  open,
  pkg,
  onOpenChange,
  onAccept,
  busy,
}: {
  open: boolean;
  pkg: SkillIndexPackage | null;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  busy: boolean;
}) {
  if (!pkg) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="skill-permissions-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-title">Confirm permissions</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {pkg.name} requests the following permissions before install or run:
        </p>
        <div className="flex flex-wrap gap-2">
          {pkg.permissions.map((perm) => (
            <Chip key={perm} variant="plain">
              {perm}
            </Chip>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={onAccept}>
            Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

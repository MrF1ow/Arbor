import { CommandDialog, CommandEmpty, CommandInput, CommandList } from "~/components/ui/command";

export function SearchPlaceholderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search">
      <CommandInput placeholder="Search arrives in PR 12…" />
      <CommandList>
        <CommandEmpty>Command palette ships in PR 12.</CommandEmpty>
      </CommandList>
    </CommandDialog>
  );
}

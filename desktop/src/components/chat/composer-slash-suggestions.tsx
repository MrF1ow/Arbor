import { cn } from "~/lib/utils";

const SLASH_COMMANDS = [
  { id: "ask", command: "/ask", description: "direct answer" },
  { id: "explain", command: "/explain", description: "step by step" },
] as const;

export function filterSlashCommands(prefix: string) {
  const lower = prefix.toLowerCase();
  return SLASH_COMMANDS.filter((entry) => entry.command.startsWith(lower));
}

export function ComposerSlashSuggestions({
  draftPrefix,
  activeIndex,
  listboxId,
}: {
  draftPrefix: string;
  activeIndex: number;
  listboxId: string;
}) {
  const options = filterSlashCommands(draftPrefix);
  if (options.length === 0) {
    return null;
  }

  return (
    <ul
      id={listboxId}
      role="listbox"
      aria-label="Slash commands"
      className="absolute bottom-full left-0 z-floating mb-1 w-full max-w-reading rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-card"
    >
      {options.map((entry, index) => (
        <li
          key={entry.id}
          id={`${listboxId}-option-${entry.id}`}
          role="option"
          aria-selected={index === activeIndex}
          className={cn(
            "cursor-default rounded-sm px-2 py-1.5 text-xs",
            index === activeIndex && "bg-selected text-foreground",
          )}
        >
          <span className="font-medium">{entry.command}</span>
          <span className="text-muted-foreground"> — {entry.description}</span>
        </li>
      ))}
    </ul>
  );
}

export function slashSuggestionInsert(command: string): string {
  return `${command} `;
}

export function isSlashSuggestionOpen(draftText: string): boolean {
  return draftText.startsWith("/") && !draftText.includes(" ");
}

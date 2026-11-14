import { GraduationCap, MessageCircle } from "lucide-react";

import { Button } from "~/components/ui/button";
import type { ChatMode } from "~/domain/chat";

/** The composer's mode pill; Shift+Tab (or a slash command) switches it. */
export function ModeChip({
  mode,
  disabled,
  onToggle,
}: {
  mode: ChatMode;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const Icon = mode === "ask" ? MessageCircle : GraduationCap;
  const label = mode === "ask" ? "Ask" : "Explain";
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={disabled}
      aria-label={`Mode: ${label} (Shift+Tab to switch)`}
      title="Shift+Tab switches between Ask and Explain"
      className="rounded-full bg-accent text-accent-foreground hover:bg-selected hover:text-accent-foreground"
      onClick={onToggle}
    >
      <Icon />
      {label}
    </Button>
  );
}

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlusIcon, SettingsIcon } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { Button, IconButton } from "~/components/ui/button";
import { TooltipProvider } from "~/components/ui/tooltip";

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider delay={0}>{ui}</TooltipProvider>);
}

describe("Button", () => {
  it("renders distinguishing classes per variant", () => {
    const { rerender } = render(<Button variant="default">Primary</Button>);
    expect(screen.getByRole("button", { name: "Primary" })).toHaveClass("bg-primary");

    rerender(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByRole("button", { name: "Ghost" })).toHaveClass("hover:bg-muted");

    rerender(<Button variant="destructive-outline">Delete</Button>);
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("text-destructive");
  });

  it("does not fire onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("IconButton", () => {
  it("sets aria-label and shows tooltip on focus", async () => {
    const user = userEvent.setup();
    renderWithTooltip(<IconButton icon={SettingsIcon} label="Settings" />);
    const button = screen.getByRole("button", { name: "Settings" });
    expect(button).toHaveAttribute("aria-label", "Settings");
    await user.hover(button);
    expect(await screen.findByTestId("tooltip-content")).toHaveTextContent("Settings");
  });
});

type IconButtonRequiresLabel = Parameters<typeof IconButton>[0] extends { label: string }
  ? true
  : false;
const _assertIconButtonLabelRequired: IconButtonRequiresLabel = true;
void _assertIconButtonLabelRequired;

// @ts-expect-error IconButton requires label
const _missingLabel = <IconButton icon={PlusIcon} />;
void _missingLabel;

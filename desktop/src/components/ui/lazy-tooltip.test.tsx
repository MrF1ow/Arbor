import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsIcon } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

describe("LazyTooltip", () => {
  it("fires the first click before the tooltip chunk loads and keeps the same button node", async () => {
    vi.resetModules();

    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    vi.doMock("~/components/ui/tooltip", async (importOriginal) => {
      await gate;
      return importOriginal<typeof import("~/components/ui/tooltip")>();
    });

    const { IconButton } = await import("~/components/ui/button");
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<IconButton icon={SettingsIcon} label="Settings" onClick={onClick} />);

    const button = screen.getByRole("button", { name: "Settings" });
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    releaseGate();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Settings" })).toBe(button);
    });

    vi.doUnmock("~/components/ui/tooltip");
    vi.resetModules();
  });
});

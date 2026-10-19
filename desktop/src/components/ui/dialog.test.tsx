import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { TooltipProvider } from "~/components/ui/tooltip";

function DialogDemo() {
  return (
    <TooltipProvider>
      <Dialog>
        <DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger>
        <DialogContent>
          <DialogTitle>Update knowledge</DialogTitle>
          <input aria-label="Course name" defaultValue="Intro to ML" />
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

describe("Dialog", () => {
  it("opens from trigger, traps focus, closes on Escape, close button named", async () => {
    const user = userEvent.setup();
    render(<DialogDemo />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Course name" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

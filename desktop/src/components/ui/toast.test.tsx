import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "~/components/ui/button";
import { toast, Toaster } from "~/components/ui/toast";

function ToastDemo() {
  return (
    <>
      <Button
        onClick={() =>
          toast("Citation check finished", {
            action: {
              label: "View log",
              onClick: () => {},
            },
          })
        }
      >
        Show toast
      </Button>
      <Toaster />
    </>
  );
}

describe("toast", () => {
  it("renders action button and fires handler", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(
      <>
        <Button
          onClick={() =>
            toast("Job complete", {
              action: { label: "View log", onClick: action },
            })
          }
        >
          Fire
        </Button>
        <Toaster />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Fire" }));
    const viewLog = await screen.findByRole("button", { name: "View log" });
    await user.click(viewLog);
    expect(action).toHaveBeenCalled();
  });
});

void ToastDemo;

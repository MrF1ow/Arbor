import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from "~/components/ui/sidebar";

describe("Sidebar", () => {
  it("controlled open toggles data-state and Mod+B calls onOpenChange", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { container } = render(
      <SidebarProvider open={false} onOpenChange={onOpenChange}>
        <Sidebar collapsible="offcanvas">
          <SidebarContent>Course nav</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );

    const shell = container.querySelector('[data-state="collapsed"]');
    expect(shell).toBeTruthy();

    await user.keyboard("{Control>}b{/Control}");
    expect(onOpenChange).toHaveBeenCalled();
    expect(screen.getByText("Course nav")).toBeInTheDocument();
  });
});

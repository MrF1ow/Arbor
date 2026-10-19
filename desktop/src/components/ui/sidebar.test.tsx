import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(() => false),
}));

import { useIsMobile } from "~/hooks/use-mobile";

import { SidebarHeaderTrigger } from "~/components/app/sidebar-header-trigger";

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
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("shows sidebar trigger on mobile when closed and opens the sheet", async () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <SidebarProvider open={false} onOpenChange={onOpenChange}>
        <SidebarHeaderTrigger />
        <Sidebar collapsible="offcanvas">
          <SidebarContent>Mobile nav</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );

    const trigger = screen.getByRole("button", { name: /toggle sidebar/i });
    expect(trigger).toBeVisible();
    await user.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("mobile uses controlled open and Mod+B calls onOpenChange", async () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <SidebarProvider open={true} onOpenChange={onOpenChange}>
        <Sidebar collapsible="offcanvas">
          <SidebarContent>Mobile nav</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    await user.keyboard("{Control>}b{/Control}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

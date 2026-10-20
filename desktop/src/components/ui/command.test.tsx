import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Command, CommandItem, CommandList } from "~/components/ui/command";

describe("CommandItem", () => {
  it("uses value-aware selected styles so false does not match highlight", () => {
    render(
      <Command value="beta">
        <CommandList>
          <CommandItem value="alpha">Alpha</CommandItem>
          <CommandItem value="beta">Beta</CommandItem>
        </CommandList>
      </Command>,
    );

    const alpha = screen.getByText("Alpha");
    const beta = screen.getByText("Beta");

    expect(alpha).toHaveAttribute("data-selected", "false");
    expect(beta).toHaveAttribute("data-selected", "true");

    expect(alpha.className).toContain("data-[selected=true]:bg-muted");
    expect(alpha.className).not.toContain("data-selected:bg-muted");
    expect(beta.className).toContain("data-[selected=true]:bg-muted");
    expect(beta.className).not.toContain("data-selected:bg-muted");
  });
});

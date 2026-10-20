import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ListRow } from "~/components/app/list-row";

describe("ListRow", () => {
  it("selects on Enter/Space and sets aria-current when active", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ListRow title="Week 3 digest" active onSelect={onSelect} meta="12 cards" />,
    );
    const row = screen.getByRole("button", { name: /Week 3 digest/ });
    expect(row).toHaveAttribute("aria-current", "page");
    row.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});

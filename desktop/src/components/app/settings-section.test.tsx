import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingRow } from "~/components/app/settings-section";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";

describe("SettingRow", () => {
  it("associates switch control with label for accessibility", () => {
    render(
      <SettingRow label="Auto-embed" description="Watch incoming PDFs." control={<Switch />} />,
    );
    expect(screen.getByRole("switch", { name: "Auto-embed" })).toBeInTheDocument();
  });

  it("does not let the row label override a button accessible name", () => {
    render(
      <SettingRow
        label="Search index"
        control={
          <Button type="button" data-testid="reindex-knowledge">
            Reindex
          </Button>
        }
      />,
    );
    expect(screen.getByRole("button", { name: "Reindex" })).toBeInTheDocument();
  });
});

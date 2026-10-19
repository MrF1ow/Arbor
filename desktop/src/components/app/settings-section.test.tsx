import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingRow } from "~/components/app/settings-section";
import { Switch } from "~/components/ui/switch";

describe("SettingRow", () => {
  it("associates switch control with label for accessibility", () => {
    render(
      <SettingRow label="Auto-embed" description="Watch incoming PDFs." control={<Switch />} />,
    );
    expect(screen.getByRole("switch", { name: "Auto-embed" })).toBeInTheDocument();
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

describe("Tabs", () => {
  afterEach(() => {
    cleanup();
  });

  it("TabsList exposes group/tabs-list and underline variant for triggers", () => {
    const { container } = render(
      <Tabs defaultValue="notes">
        <TabsList variant="underline">
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const list = container.querySelector('[data-slot="tabs-list"]');
    expect(list).toHaveClass("group/tabs-list");
    expect(list).toHaveAttribute("data-variant", "underline");
    expect(screen.getByRole("tab", { name: "Notes" }).className).toMatch(/group-data-\[variant=underline\]/);
  });

  it("moves selection with arrow keys and sets aria-selected", async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="notes">
        <TabsList>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="quiz">Quiz</TabsTrigger>
        </TabsList>
        <TabsContent value="notes">Notes panel</TabsContent>
        <TabsContent value="quiz">Quiz panel</TabsContent>
      </Tabs>,
    );

    const notes = screen.getByRole("tab", { name: "Notes" });
    const quiz = screen.getByRole("tab", { name: "Quiz" });
    await user.click(notes);
    expect(notes).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(quiz).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(quiz).toHaveAttribute("aria-selected", "true");
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusPill } from "~/components/app/status-pill";
import { JOB_START_LABEL, runningJobStatusLabel } from "~/domain/job-labels";

describe("StatusPill", () => {
  it("renders the running job label from the store pipeline", () => {
    const label = runningJobStatusLabel(null, JOB_START_LABEL.flashcards);
    render(<StatusPill variant="running" label={label} />);
    expect(screen.getByText(JOB_START_LABEL.flashcards)).toBeInTheDocument();
  });
});

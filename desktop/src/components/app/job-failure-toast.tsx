import { useEffect, useRef } from "react";

import { toast } from "~/components/ui/toast";
import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";

export function JobFailureToast() {
  const status = useJobStore((s) => s.status);
  const prev = useRef(status);
  const setLogOpen = useUiStore((s) => s.setLogOpen);

  useEffect(() => {
    if (prev.current !== "failed" && status === "failed") {
      toast.error("Last job failed", {
        action: {
          label: "View log",
          onClick: () => setLogOpen(true),
        },
      });
    }
    prev.current = status;
  }, [setLogOpen, status]);

  return null;
}

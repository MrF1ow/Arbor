import { Button } from "~/components/ui/button";
import { useStudyWriteStatus } from "~/lib/study-writes";

export function UnsavedBadge() {
  const { label, retry } = useStudyWriteStatus();
  if (!label) {
    return null;
  }
  return (
    <Button type="button" variant="outline" size="xs" onClick={() => retry()}>
      {label}
    </Button>
  );
}

import { Badge } from "~/components/ui/badge";

/** The red "Unverified · slide 9 not found" tag: the citation check could not find the cited passage. */
export function StudyUnverifiedBadge({ reason }: { reason?: string }) {
  const why = reason ?? "Citation check failed";
  return (
    <Badge variant="destructive" className="h-auto max-w-full cursor-default rounded-xs px-1 text-micro" title={why}>
      <span>Unverified</span>
      <span aria-hidden>·</span>
      <span className="truncate">{why}</span>
    </Badge>
  );
}

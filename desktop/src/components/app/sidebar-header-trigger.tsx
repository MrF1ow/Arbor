import { SidebarTrigger, useSidebar } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";

export function SidebarHeaderTrigger({ className }: { className?: string }) {
  const { open } = useSidebar();
  if (open) {
    return null;
  }
  return (
    <div className={cn("flex shrink-0 items-center", className)}>
      <SidebarTrigger />
    </div>
  );
}

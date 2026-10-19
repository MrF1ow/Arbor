import type { ComponentProps } from "react";

import { PageHeader } from "~/components/app/page-header";
import { SidebarHeaderTrigger } from "~/components/app/sidebar-header-trigger";
import { cn } from "~/lib/utils";

export function ShellPageHeader({ className, ...props }: ComponentProps<typeof PageHeader>) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <SidebarHeaderTrigger className="self-center" />
      <PageHeader {...props} className={cn("min-w-0 flex-1", className)} />
    </div>
  );
}

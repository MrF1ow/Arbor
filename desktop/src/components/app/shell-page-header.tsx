import type { ComponentProps } from "react";

import { PageHeader } from "~/components/app/page-header";
import { cn } from "~/lib/utils";

/** A page header for the shell's pages: the top bar owns the sidebar trigger, so this adds none. */
export function ShellPageHeader({ className, ...props }: ComponentProps<typeof PageHeader>) {
  return <PageHeader {...props} className={cn("min-w-0", className)} />;
}

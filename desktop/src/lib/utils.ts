import { clsx, type ClassValue } from "clsx";

import { twMerge } from "~/lib/tailwind-merge-config";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "~/lib/utils";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-input transition-colors duration-fast ease-out-soft outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-icon-sm translate-x-0 rounded-full bg-card shadow-card transition-transform duration-fast ease-out-soft data-checked:translate-x-4"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };

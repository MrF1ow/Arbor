import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";

export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div>
        <h2 className="font-serif text-lg font-medium">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="divide-y divide-border rounded-md border border-border bg-card">{children}</div>
    </section>
  );
}

function associateControl(control: ReactNode, controlId: string): ReactNode {
  if (!isValidElement(control)) {
    return control;
  }
  const props = control.props as { id?: string };
  if (props.id) {
    return control;
  }
  return cloneElement(control as ReactElement<{ id?: string }>, { id: controlId });
}

function labelAssociatesWithControl(control: ReactNode, controlIdProp?: string): boolean {
  if (controlIdProp) {
    return true;
  }
  if (!isValidElement(control)) {
    return false;
  }
  const type = control.type;
  if (type === Button) {
    return false;
  }
  return type === Switch || type === Input || type === Select;
}

export function SettingRow({
  label,
  description,
  control,
  className,
  controlId: controlIdProp,
}: {
  label: string;
  description?: string;
  control: ReactNode;
  className?: string;
  /** When set, labels associate with this id (for nested controls). */
  controlId?: string;
}) {
  const generatedId = useId();
  const controlId = controlIdProp ?? generatedId;
  const associate = labelAssociatesWithControl(control, controlIdProp);
  const resolvedControl =
    associate && !controlIdProp ? associateControl(control, controlId) : control;

  return (
    <div
      className={cn(
        "flex min-h-row flex-wrap items-center justify-between gap-4 px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        {associate ? (
          <Label htmlFor={controlId} className="text-sm font-medium">
            {label}
          </Label>
        ) : (
          <span className="text-sm font-medium">{label}</span>
        )}
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0">{resolvedControl}</div>
    </div>
  );
}

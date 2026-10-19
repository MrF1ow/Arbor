import { useId, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Field, FieldError } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { PROVIDER_FALLBACK, signedOutJobMessage } from "~/domain/provider";
import {
  alignmentNote,
  formatRanges,
  selectionsFromRangeValues,
  validateRangeValue,
  validateRangeValues,
} from "~/domain/update";
import { VIEWER_WRITE_REASON, viewerBlocksWrite } from "~/domain/library-role";
import { fetchAuthStatus } from "~/lib/auth-refresh";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useEffectiveProvider } from "~/lib/queries/effective-provider";
import { useLibrary } from "~/lib/queries/library";
import { useStartUpdateMutation } from "~/lib/queries/jobs";
import { useSettings } from "~/lib/queries/settings";
import { cn } from "~/lib/utils";
import { useJobStore } from "~/stores/job-store";
import { useUpdatePlanStore } from "~/stores/update-plan-store";
import type { PendingSource } from "~/domain/types";

function initialRangeValues(pending: PendingSource[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const p of pending) {
    values[p.path] =
      p.suggested_ranges.length > 0 ? formatRanges(p.suggested_ranges) : "";
  }
  return values;
}

function pendingKey(pending: PendingSource[]): string {
  return pending.map((p) => p.path).join("\0");
}

export function UpdateReviewDialog() {
  const open = useUpdatePlanStore((s) => s.open);
  const pending = useUpdatePlanStore((s) => s.pending);
  const close = useUpdatePlanStore((s) => s.close);
  const appendLog = useJobStore((s) => s.append);
  const skipCancelLogRef = useRef(false);

  if (!pending) {
    return null;
  }

  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!next) {
          if (!skipCancelLogRef.current) {
            appendLog("Update cancelled before processing.");
          }
          skipCancelLogRef.current = false;
          close();
        }
      }}
    >
      {open ? (
        <UpdateReviewDialogForm
          key={pendingKey(pending)}
          pending={pending}
          skipCancelLogRef={skipCancelLogRef}
        />
      ) : null}
    </Dialog>
  );
}

function UpdateReviewDialogForm({
  pending,
  skipCancelLogRef,
}: {
  pending: PendingSource[];
  skipCancelLogRef: React.MutableRefObject<boolean>;
}) {
  const trigger = useUpdatePlanStore((s) => s.trigger);
  const close = useUpdatePlanStore((s) => s.close);
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const library = useLibrary(activeRoot);
  const role = library.data?.present === true ? library.data.role : null;
  const viewerBlocked = viewerBlocksWrite(role);
  const effective = useEffectiveProvider(activeRoot);
  const startUpdate = useStartUpdateMutation(activeRoot);
  const appendLog = useJobStore((s) => s.append);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const formId = useId();

  const [rangeValues, setRangeValues] = useState(() => initialRangeValues(pending));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fileCount = pending.length;
  const hasErrors = Object.keys(errors).length > 0;

  const setFieldError = (path: string, message: string | null) => {
    setErrors((prev) => {
      if (!message) {
        if (!(path in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[path];
        return next;
      }
      return { ...prev, [path]: message };
    });
  };

  const runValidation = () => {
    const next = validateRangeValues(pending, rangeValues);
    setErrors(next);
    return next;
  };

  const onCancel = () => {
    appendLog("Update cancelled before processing.");
    skipCancelLogRef.current = true;
    close();
  };

  const onConfirm = async () => {
    const nextErrors = runValidation();
    if (Object.keys(nextErrors).length > 0 || viewerBlocked || !activeRoot || !effective.modelId) {
      return;
    }
    const providerLabel =
      PROVIDER_FALLBACK.find((p) => p.id === effective.providerId)?.label ??
      effective.providerId;
    const auth = await fetchAuthStatus(effective.providerId, true);
    if (!auth.authenticated) {
      appendLog(signedOutJobMessage(providerLabel, auth.reason ?? ""));
      return;
    }
    try {
      const selections = selectionsFromRangeValues(pending, rangeValues);
      const jobId = await startUpdate.mutateAsync({
        model: effective.modelId,
        provider: effective.providerId,
        selections,
        trigger,
      });
      appendLog(`Job ${jobId} started.`);
      skipCancelLogRef.current = true;
      close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Update failed to start: ${message}`);
    }
  };

  const onBlurValidate = () => {
    setErrors(validateRangeValues(pending, rangeValues));
  };

  const onRangeChange = (path: string, pageCount: number, value: string) => {
    setRangeValues((prev) => ({ ...prev, [path]: value }));
    setFieldError(path, validateRangeValue(value, pageCount));
  };

  const onRangeKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    const current = pending[index]!;
    const fieldError = validateRangeValue(rangeValues[current.path] ?? "", current.page_count);
    setFieldError(current.path, fieldError);
    if (fieldError) {
      return;
    }
    const nextIndex = index + 1;
    if (nextIndex < pending.length) {
      inputRefs.current[nextIndex]?.focus();
      return;
    }
    const allErrors = validateRangeValues(pending, rangeValues);
    setErrors(allErrors);
    if (Object.keys(allErrors).length > 0) {
      return;
    }
    void onConfirm();
  };

  const confirmDisabled =
    viewerBlocked || hasErrors || !effective.modelId || startUpdate.isPending;

  return (
    <DialogContent className="max-w-2xl" showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>Files to process</DialogTitle>
        <DialogDescription>
          {fileCount} file(s) to process. Ranges like <code>151-300</code> or{" "}
          <code>40-55, 120-122</code>. Leave blank for the whole file.
        </DialogDescription>
      </DialogHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead className="w-16">Pages</TableHead>
            <TableHead>Ranges</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pending.map((p, index) => {
            const note = alignmentNote(p);
            const ambiguous = p.alignment_status === "ambiguous";
            const inputId = `${formId}-range-${index}`;
            const errorId = `${inputId}-error`;
            const fieldError = errors[p.path];
            return (
              <TableRow key={p.path}>
                <TableCell className="max-w-48">
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="block truncate text-sm">{p.path}</span>}
                    />
                    <TooltipContent>{p.path}</TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className="text-muted-foreground">{p.page_count}</TableCell>
                <TableCell>
                  <Field data-invalid={Boolean(fieldError)}>
                    <Input
                      id={inputId}
                      ref={(el) => {
                        inputRefs.current[index] = el;
                      }}
                      value={rangeValues[p.path] ?? ""}
                      placeholder="all"
                      aria-label={`Ranges for ${p.path}`}
                      aria-invalid={Boolean(fieldError)}
                      aria-describedby={fieldError ? errorId : undefined}
                      onChange={(e) => onRangeChange(p.path, p.page_count, e.target.value)}
                      onBlur={onBlurValidate}
                      onKeyDown={(e) => onRangeKeyDown(index, e)}
                    />
                    {fieldError ? (
                      <FieldError id={errorId}>{fieldError}</FieldError>
                    ) : null}
                    {note ? (
                      <p
                        className={cn(
                          "text-xs",
                          ambiguous ? "text-destructive" : "text-faint-foreground",
                        )}
                      >
                        {note}
                      </p>
                    ) : null}
                  </Field>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <span className="inline-flex" title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}>
          <Button disabled={confirmDisabled} onClick={() => void onConfirm()}>
            Confirm
          </Button>
        </span>
      </DialogFooter>
    </DialogContent>
  );
}

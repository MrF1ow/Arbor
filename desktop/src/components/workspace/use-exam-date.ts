import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { invoke } from "~/lib/ipc";
import { useCourseMeta } from "~/lib/queries/course-meta";
import { qk } from "~/lib/queries/keys";
import { scheduleTodayRefresh } from "~/lib/study-writes";

/**
 * The class's exam date (`YYYY-MM-DD`): the one saved on the class, as Today reads it. The date
 * the study plan's text names is the plan's content, not the class's exam date.
 */
export function useExamDate(root: string | null, course: string): string | null {
  const meta = useCourseMeta(root);
  const saved = meta.data?.[course]?.exam_date;
  return typeof saved === "string" && saved !== "" ? saved : null;
}

/**
 * Save or clear (`""`) the exam date. Only `examDate` goes out (Tauri maps command args by camelCase), so the class's icon and colour
 * are left alone (the backend merges partial updates).
 */
export function useSetExamDate(root: string | null, course: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (examDate: string) =>
      invoke("set_course_meta", { root: root!, course, examDate }),
    // Returned, so the write settles only once the refetch it started has landed.
    onSuccess: () => {
      if (!root) {
        return undefined;
      }
      scheduleTodayRefresh(queryClient, root);
      return queryClient.invalidateQueries({ queryKey: qk.courseMeta(root) });
    },
  });
}

const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/** A complete, real date with a four-digit year in 1900-2100 (`0002-…` and `12027-…` are not). */
export function isCommittableExamDate(value: string): boolean {
  const match = FULL_DATE.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A saved `YYYY-MM-DD` as a local calendar date (no UTC conversion), or `undefined` when it is empty or not a real date. */
export function parseExamDate(value: string): Date | undefined {
  if (!isCommittableExamDate(value)) {
    return undefined;
  }
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

/** A picked local calendar day as `YYYY-MM-DD`, from the local fields (never `toISOString`, which shifts the day near midnight UTC). */
export function toExamDate(date: Date): string {
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/**
 * The exam date for the calendar popover: a picked day (or Clear, `""`) that differs from the saved
 * one is written at once. A failed write shows an error and picking again retries it. The field
 * follows the last value committed until the refetch of that write has landed (`pending`), so a
 * refetch of an earlier write arriving mid-write cannot undo the latest commit.
 */
export function useExamDateField(root: string | null, course: string, readOnly: boolean) {
  const saved = useExamDate(root, course) ?? "";
  const { mutateAsync: write } = useSetExamDate(root, course);
  // The last committed value (and its class) until its write's refetch has landed.
  const [pendingWrite, setPendingWrite] = useState<{ course: string; value: string } | null>(null);
  const pending = pendingWrite?.course === course ? pendingWrite.value : null;
  const latestWrite = useRef(0);
  const [error, setError] = useState(false);

  const commit = (value: string) => {
    if (readOnly || !root) {
      return;
    }
    if (value === (pending ?? saved)) {
      return;
    }
    if (value !== "" && !isCommittableExamDate(value)) {
      return;
    }
    latestWrite.current += 1;
    const mine = latestWrite.current;
    setError(false);
    setPendingWrite({ course, value });
    write(value).then(
      () => {
        if (latestWrite.current === mine) {
          setPendingWrite(null);
        }
      },
      () => {
        if (latestWrite.current === mine) {
          setPendingWrite(null);
          setError(true);
        }
      },
    );
  };

  return {
    /** The date shown: the last one committed until its refetch lands, else the saved one (`""` when none). */
    value: pending ?? saved,
    /** Save a `YYYY-MM-DD`, or clear with `""`. */
    commit,
    /** The last write failed. */
    error,
    /** The saved date, for the header and the plan request. */
    saved,
  };
}

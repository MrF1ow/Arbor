import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

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
 * Save or clear (`""`) the exam date. Only `exam_date` goes out, so the class's icon and colour
 * are left alone (the backend merges partial updates).
 */
export function useSetExamDate(root: string | null, course: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (examDate: string) =>
      invoke("set_course_meta", { root: root!, course, exam_date: examDate }),
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

/**
 * The exam date input: what is typed stays a draft, and only a full valid date (or an emptied
 * field) that differs from the saved one is written, on blur or Enter. A date input reports every
 * digit of the year as a full date (`0002-…`, `0020-…`), so saving on change would send each; a
 * draft that is not committable stays in the field and is shown invalid. A failed write shows an
 * error and the next blur or Enter retries it. The field follows the last value the user
 * committed until the refetch of that write has landed (`pending`), so a refetch of an earlier
 * write arriving mid-write cannot undo the latest commit. The draft is dropped when the saved
 * date changes (another device updated it).
 */
export function useExamDateField(root: string | null, course: string, readOnly: boolean) {
  const saved = useExamDate(root, course) ?? "";
  const { mutateAsync: write } = useSetExamDate(root, course);
  const [draft, setDraft] = useState<string | null>(null);
  const [seenSaved, setSeenSaved] = useState(saved);
  // The last committed value (and its class) until its write's refetch has landed.
  const [pendingWrite, setPendingWrite] = useState<{ course: string; value: string } | null>(null);
  const pending = pendingWrite?.course === course ? pendingWrite.value : null;
  const latestWrite = useRef(0);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState(false);
  if (seenSaved !== saved) {
    setSeenSaved(saved);
    setDraft(null);
  }
  const badInput = useRef(false);

  const commit = () => {
    if (readOnly || !root || draft === null) {
      return;
    }
    if (badInput.current) {
      setInvalid(true);
      return;
    }
    if (draft === (pending ?? saved)) {
      return;
    }
    if (draft !== "" && !isCommittableExamDate(draft)) {
      setInvalid(true);
      return;
    }
    latestWrite.current += 1;
    const mine = latestWrite.current;
    setPendingWrite({ course, value: draft });
    write(draft).then(
      () => {
        if (latestWrite.current === mine) {
          setError(false);
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

  // A date picked and then left unblurred (navigating away) still saves.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => () => commitRef.current(), []);

  return {
    value: draft ?? pending ?? saved,
    /** `unfinished`: the picker holds a partly typed date, which reports an empty value. */
    onChange: (value: string, unfinished = false) => {
      badInput.current = unfinished;
      setDraft(value);
      setInvalid(false);
      setError(false);
    },
    onBlur: commit,
    onKeyDown: (event: { key: string }) => {
      if (event.key === "Enter") {
        commit();
      }
    },
    /** The draft is not a date that can be saved (shown after a blur or Enter, not while typing). */
    invalid,
    /** The last write failed. */
    error,
    /** The saved date, for the header and the plan request. */
    saved,
  };
}

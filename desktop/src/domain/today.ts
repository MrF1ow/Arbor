import { toCourseDigest } from "~/domain/lectures";

/** Correct and total answers in one week. */
export type Acc = { correct: number; total: number };

export type NextExam = { course: string; exam_date: string; days_to_exam: number };

/** One class row as `study_today` returns it. */
export type TodayCourseRow = {
  course: string;
  digest_count: number;
  due_ids: string[];
  deck_count: number;
  mastered: number;
  mastery: number | null;
  exam_date: string | null;
  days_to_exam: number | null;
  plan: { done: number; total: number } | null;
  /** Set when the worker could not read this class; the other fields are then empty. */
  error?: string;
};

export type WeakTopic = {
  course: string;
  label: string;
  /** Course-prefixed (`Course/digests/x.md`) once merged; the worker sends `digests/x.md`. */
  digest: string;
  heading: string | null;
  wrong_rate: number;
  /** "4 of 9" is `wrong` of `wrong + correct`. */
  wrong: number;
  correct: number;
};

/** The `study_today` JSON for one library. */
export type TodayPayload = {
  courses: TodayCourseRow[];
  weak_topics: WeakTopic[];
  quiz_accuracy: { this_week: Acc; last_week: Acc };
  next_exam: NextExam | null;
};

export type TodayCourse = TodayCourseRow & { root: string };

export type TodaySummary = {
  courses: TodayCourse[];
  weak_topics: (WeakTopic & { root: string })[];
  quiz_accuracy: { this_week: Acc; last_week: Acc };
  next_exam: (NextExam & { root: string }) | null;
  errors: { root: string; message: string }[];
};

/** What one library's `study_today` call produced: its payload, or why it failed. */
export type TodayResult = { root: string; payload: TodayPayload } | { root: string; error: string };

function addAcc(into: Acc, from: Acc) {
  into.correct += from.correct;
  into.total += from.total;
}

/**
 * Merge the per-library `study_today` results into the one Today summary (Q7).
 * A failing library is listed in `errors`; the libraries that answered still show.
 * Quiz accuracy counts are summed, the earliest next exam wins, and weak topics
 * are sorted by wrong rate (ties by label, then class, as the worker does).
 */
export function mergeToday(results: TodayResult[]): TodaySummary {
  const summary: TodaySummary = {
    courses: [],
    weak_topics: [],
    quiz_accuracy: {
      this_week: { correct: 0, total: 0 },
      last_week: { correct: 0, total: 0 },
    },
    next_exam: null,
    errors: [],
  };
  for (const result of results) {
    if ("error" in result) {
      summary.errors.push({ root: result.root, message: result.error });
      continue;
    }
    const { root, payload } = result;
    for (const course of payload.courses) {
      summary.courses.push({ ...course, root });
    }
    for (const topic of payload.weak_topics) {
      summary.weak_topics.push({
        ...topic,
        digest: toCourseDigest(topic.course, topic.digest),
        root,
      });
    }
    addAcc(summary.quiz_accuracy.this_week, payload.quiz_accuracy.this_week);
    addAcc(summary.quiz_accuracy.last_week, payload.quiz_accuracy.last_week);
    const exam = payload.next_exam;
    if (exam && (!summary.next_exam || exam.exam_date < summary.next_exam.exam_date)) {
      summary.next_exam = { ...exam, root };
    }
  }
  summary.weak_topics.sort(
    (a, b) =>
      b.wrong_rate - a.wrong_rate ||
      a.label.localeCompare(b.label) ||
      a.course.localeCompare(b.course),
  );
  return summary;
}

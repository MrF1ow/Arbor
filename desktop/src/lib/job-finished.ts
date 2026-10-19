import { shouldAutoGenerateFlashcards } from "~/domain/flashcards";
import { shouldAutoGenerateQuiz } from "~/domain/quiz";
import type { JobFinished, KnowledgeSettings } from "~/domain/types";

export type JobFinishedDeps = {
  activeUpdateJobId: string | null;
  currentCourse: string | null;
  activeRoot: string | null;
  getKnowledgeSettings: (root: string) => Promise<KnowledgeSettings>;
  invalidateAfterJob: (root: string, course: string | null) => void;
  startFlashcardsJob: (force: boolean) => Promise<void>;
  startQuizJob: (force: boolean) => Promise<void>;
  startEmbedJob: (root: string) => Promise<void>;
};

export type JobFinishedState = {
  pendingAutoEmbed: boolean;
  pendingAutoQuiz: boolean;
};

export async function onJobFinished(
  finished: JobFinished,
  deps: JobFinishedDeps,
  state: JobFinishedState,
): Promise<JobFinishedState> {
  const next = { ...state };
  const updateJobId = deps.activeUpdateJobId;

  deps.invalidateAfterJob(
    finished.root || deps.activeRoot || "",
    deps.currentCourse,
  );

  if (finished.status !== "succeeded") {
    if (finished.operation === "generate") {
      next.pendingAutoQuiz = false;
      next.pendingAutoEmbed = false;
    }
    return next;
  }

  const root = deps.activeRoot;
  if (!root || (finished.root && finished.root !== root)) {
    return next;
  }

  const settings = await deps.getKnowledgeSettings(root);

  if (updateJobId !== null && finished.job_id === updateJobId) {
    next.pendingAutoQuiz = shouldAutoGenerateQuiz(
      finished,
      updateJobId,
      settings.auto_generate.quiz,
    );
    next.pendingAutoEmbed = settings.auto_embed;
  }

  if (
    deps.currentCourse &&
    shouldAutoGenerateFlashcards(finished, updateJobId, settings.auto_generate.flashcards)
  ) {
    await deps.startFlashcardsJob(false);
    return next;
  }

  if (next.pendingAutoQuiz && deps.currentCourse) {
    next.pendingAutoQuiz = false;
    await deps.startQuizJob(false);
    return next;
  }

  if (next.pendingAutoEmbed) {
    next.pendingAutoEmbed = false;
    await deps.startEmbedJob(root);
  }

  return next;
}

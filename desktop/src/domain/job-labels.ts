export const JOB_START_LABEL = {
  update: "Updating knowledge",
  flashcards: "Generating flashcards",
  quiz: "Generating quiz",
  concepts: "Building concept graph",
  diagrams: "Generating diagrams",
  citations: "Checking citations",
  embed: "Updating embeddings",
} as const;

export type JobStartLabel = (typeof JOB_START_LABEL)[keyof typeof JOB_START_LABEL];

export function runningJobStatusLabel(step: string | null, label: string | null): string {
  return step ?? label ?? "Running…";
}
